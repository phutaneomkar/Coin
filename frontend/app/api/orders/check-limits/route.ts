import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fetchBinanceTicker, getBinanceSymbol } from '@/lib/api/binance';

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

      // Update or create holdings
      const { data: existingHolding } = await supabase
        .from('holdings')
        .select('*')
        .eq('user_id', userId)
        .eq('coin_id', order.coin_id)
        .maybeSingle();

      if (existingHolding) {
        // Calculate new average buy price
        const totalQuantity = existingHolding.quantity + order.quantity;
        const totalCostOld = existingHolding.average_buy_price * existingHolding.quantity;
        const totalCostNew = order.total_amount;
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
        // Create new holding
        await supabase
          .from('holdings')
          .insert({
            user_id: userId,
            coin_id: order.coin_id,
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
      // Check holdings
      const { data: holding } = await supabase
        .from('holdings')
        .select('*')
        .eq('user_id', userId)
        .eq('coin_id', order.coin_id)
        .single();

      if (!holding || holding.quantity < order.quantity) {
        throw new Error('Insufficient holdings');
      }

      // Update holdings
      const newQuantity = holding.quantity - order.quantity;
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

/**
 * Check and execute pending limit orders when price conditions are met
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all pending limit orders
    const { data: pendingOrders, error: ordersError } = await supabase
      .from('orders')
      .select('*')
      .eq('order_status', 'pending')
      .eq('order_mode', 'limit')
      .not('price_per_unit', 'is', null);

    if (ordersError) {
      console.error('Error fetching pending orders:', ordersError);
      return NextResponse.json(
        { error: 'Failed to fetch pending orders' },
        { status: 500 }
      );
    }

    if (!pendingOrders || pendingOrders.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No pending limit orders',
        executed: 0,
      });
    }

    let executedCount = 0;
    const errors: string[] = [];

    // Check each pending order
    for (const order of pendingOrders) {
      try {
        // Get current market price
        const binanceSymbol = getBinanceSymbol(order.coin_id);
        if (!binanceSymbol) {
          errors.push(`Coin ${order.coin_id} not supported on Binance`);
          continue;
        }

        const ticker = await fetchBinanceTicker(binanceSymbol);
        const currentPrice = parseFloat(ticker.lastPrice) || 0;
        const limitPrice = parseFloat(order.price_per_unit) || 0;

        if (currentPrice <= 0 || limitPrice <= 0) {
          console.log(`Skipping order ${order.id}: Invalid prices - current: ${currentPrice}, limit: ${limitPrice}`);
          continue;
        }

        // Check if price condition is met
        let shouldExecute = false;

        if (order.order_type === 'buy') {
          // Buy limit: execute when current price drops to or below limit price
          // Example: Market $100, Limit $95 -> Execute when price hits $95 or below
          // Logic: If market is $100 and limit is $95, wait for price to drop to $95
          shouldExecute = currentPrice <= limitPrice;
          console.log(`Buy limit order ${order.id}: Current=${currentPrice}, Limit=${limitPrice}, Execute=${shouldExecute}`);
        } else if (order.order_type === 'sell') {
          // Sell limit: execute when current price rises to or above limit price
          // Example: Market $100, Limit $105 -> Execute when price hits $105 or above
          // Logic: If market is $100 and limit is $105, wait for price to rise to $105
          shouldExecute = currentPrice >= limitPrice;
          console.log(`Sell limit order ${order.id}: Current=${currentPrice}, Limit=${limitPrice}, Execute=${shouldExecute}`);
        }

        if (shouldExecute) {
          console.log(`Executing ${order.order_type} limit order ${order.id} at price ${currentPrice}`);
          
          // Update order with execution price (use current market price, not limit price)
          const executionPrice = currentPrice;
          const totalAmount = executionPrice * order.quantity;

          // Update order total amount with actual execution price
          const { error: updateError } = await supabase
            .from('orders')
            .update({
              price_per_unit: executionPrice,
              total_amount: totalAmount,
              order_status: 'completed',
              completed_at: new Date().toISOString(),
            })
            .eq('id', order.id);

          if (updateError) {
            throw new Error(`Failed to update order: ${updateError.message}`);
          }

          // Execute the order (update balance/holdings)
          await executeOrder(supabase, order.user_id, {
            ...order,
            price_per_unit: executionPrice,
            total_amount: totalAmount,
          }, executionPrice);

          executedCount++;
          console.log(`Successfully executed order ${order.id}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Order ${order.id}: ${errorMessage}`);
        console.error(`Error processing order ${order.id}:`, error);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${pendingOrders.length} pending orders`,
      executed: executedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Error checking limit orders:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
