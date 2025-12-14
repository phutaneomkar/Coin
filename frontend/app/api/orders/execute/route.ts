import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const TRADING_FEE_RATE = 0.001; // 0.1% trading fee

/**
 * Execute a completed order - update balance, holdings, and create transaction
 */
async function executeOrder(
  supabase: any,
  userId: string,
  order: any,
  executionPrice: number
) {
  try {
    const tradingFee = order.total_amount * TRADING_FEE_RATE;
    const totalCost = order.total_amount + tradingFee;

    if (order.order_type === 'buy') {
      // Deduct balance
      const { data: profile } = await supabase
        .from('profiles')
        .select('balance_inr')
        .eq('id', userId)
        .single();

      if (!profile) {
        throw new Error('Profile not found');
      }

      const newBalance = profile.balance_inr - totalCost;
      if (newBalance < 0) {
        throw new Error('Insufficient balance after fee calculation');
      }

      // Update balance
      await supabase
        .from('profiles')
        .update({ balance_inr: newBalance })
        .eq('id', userId);

      // Update or create holdings - normalize coin_id for consistency
      const normalizedCoinId = (order.coin_id || '').toLowerCase().trim();
      
      // Try to find existing holding with case-insensitive matching
      let { data: existingHolding } = await supabase
        .from('holdings')
        .select('*')
        .eq('user_id', userId)
        .eq('coin_id', normalizedCoinId)
        .maybeSingle();

      // If not found, try case-insensitive search
      if (!existingHolding) {
        const { data: allHoldings } = await supabase
          .from('holdings')
          .select('*')
          .eq('user_id', userId);

        if (allHoldings) {
          existingHolding = allHoldings.find(
            h => h.coin_id?.toLowerCase() === normalizedCoinId
          );
        }
      }

      if (existingHolding) {
        // Calculate new average buy price
        const totalQuantity = parseFloat(existingHolding.quantity.toString()) + parseFloat(order.quantity.toString());
        const totalCostOld = parseFloat(existingHolding.average_buy_price.toString()) * parseFloat(existingHolding.quantity.toString());
        const totalCostNew = parseFloat(order.total_amount.toString());
        const newAveragePrice = (totalCostOld + totalCostNew) / totalQuantity;

        await supabase
          .from('holdings')
          .update({
            quantity: totalQuantity,
            average_buy_price: newAveragePrice,
            last_updated: new Date().toISOString(),
          })
          .eq('id', existingHolding.id);
      } else {
        // Create new holding - use normalized coin_id
        await supabase
          .from('holdings')
          .insert({
            user_id: userId,
            coin_id: normalizedCoinId, // Use normalized coin_id
            coin_symbol: order.coin_symbol,
            quantity: order.quantity,
            average_buy_price: executionPrice,
            last_updated: new Date().toISOString(),
          });
      }

      // Create transaction record
      await supabase
        .from('transactions')
        .insert({
          user_id: userId,
          order_id: order.id,
          transaction_type: 'buy',
          coin_id: order.coin_id,
          coin_symbol: order.coin_symbol,
          quantity: order.quantity,
          price_per_unit: executionPrice,
          total_amount: order.total_amount,
          transaction_date: new Date().toISOString(),
        });

    } else if (order.order_type === 'sell') {
      // Check holdings - with case-insensitive matching
      const normalizedCoinId = (order.coin_id || '').toLowerCase().trim();
      
      // First try with normalized coin_id
      let { data: holding, error: holdingError } = await supabase
        .from('holdings')
        .select('*')
        .eq('user_id', userId)
        .eq('coin_id', normalizedCoinId)
        .maybeSingle();

      // If not found, try case-insensitive search
      if (!holding && !holdingError) {
        const { data: allHoldings } = await supabase
          .from('holdings')
          .select('*')
          .eq('user_id', userId);

        if (allHoldings) {
          holding = allHoldings.find(
            h => h.coin_id?.toLowerCase() === normalizedCoinId
          );
        }
      }

      const availableQty = holding ? parseFloat(holding.quantity.toString()) : 0;
      const requiredQty = parseFloat(order.quantity.toString());

      if (!holding || availableQty < requiredQty) {
        throw new Error(`Insufficient holdings. Required: ${requiredQty}, Available: ${availableQty}`);
      }

      // Update holdings
      const currentQty = parseFloat(holding.quantity.toString());
      const sellQty = parseFloat(order.quantity.toString());
      const newQuantity = currentQty - sellQty;
      
      if (newQuantity > 0) {
        await supabase
          .from('holdings')
          .update({
            quantity: newQuantity,
            last_updated: new Date().toISOString(),
          })
          .eq('id', holding.id);
      } else {
        // Remove holding if quantity is 0
        await supabase
          .from('holdings')
          .delete()
          .eq('id', holding.id);
      }

      // Add balance (minus trading fee)
      const { data: profile } = await supabase
        .from('profiles')
        .select('balance_inr')
        .eq('id', userId)
        .single();

      if (!profile) {
        throw new Error('Profile not found');
      }

      const proceeds = order.total_amount - tradingFee;
      const newBalance = profile.balance_inr + proceeds;

      await supabase
        .from('profiles')
        .update({ balance_inr: newBalance })
        .eq('id', userId);

      // Create transaction record
      await supabase
        .from('transactions')
        .insert({
          user_id: userId,
          order_id: order.id,
          transaction_type: 'sell',
          coin_id: order.coin_id,
          coin_symbol: order.coin_symbol,
          quantity: order.quantity,
          price_per_unit: executionPrice,
          total_amount: order.total_amount,
          transaction_date: new Date().toISOString(),
        });
    }
  } catch (error) {
    console.error('Error executing order:', error);
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { orderId, executionPrice } = await request.json();

    if (!orderId || !executionPrice) {
      return NextResponse.json(
        { error: 'orderId and executionPrice are required' },
        { status: 400 }
      );
    }

    // Get order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .eq('user_id', user.id)
      .single();

    if (orderError || !order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      );
    }

    if (order.order_status !== 'pending') {
      return NextResponse.json(
        { error: 'Order is not pending' },
        { status: 400 }
      );
    }

    // Execute order
    await executeOrder(supabase, user.id, order, executionPrice);

    // Update order status
    await supabase
      .from('orders')
      .update({
        order_status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    return NextResponse.json({ success: true, message: 'Order executed successfully' });
  } catch (error) {
    console.error('Error executing order:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
