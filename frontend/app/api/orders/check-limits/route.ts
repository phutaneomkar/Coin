import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '../../../../lib/supabase/server';
import { fetchBinanceTicker, getBinanceSymbol } from '../../../../lib/api/binance';


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

    let userId = user?.id;
    if (!userId) {
      // Check for app_access cookie
      const hasAccess = request.cookies.has('app_access');
      if (hasAccess) {
        // Use default user ID if cookie is present
        userId = '00000000-0000-0000-0000-000000000000'; // DEFAULT_USER_ID
      } else {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
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
        logs: ['No pending limit orders found']
      });
    }

    let executedCount = 0;
    const errors: string[] = [];
    const logs: string[] = []; // Collect logs to return to client for debugging

    // Check each pending order
    for (const order of pendingOrders) {
      try {
        const coinId = (order.coin_id || '').trim();
        logs.push(`Order #${order.id} | ${order.order_type} ${coinId} @ ${order.price_per_unit}`);

        // Get current market price
        const binanceSymbol = getBinanceSymbol(coinId);
        if (!binanceSymbol) {
          const msg = `Coin ${coinId} not supported on Binance (Symbol not found)`;
          errors.push(msg);
          logs.push(msg);
          continue;
        }

        const ticker = await fetchBinanceTicker(binanceSymbol);
        const currentPrice = parseFloat(ticker.lastPrice) || 0;
        const limitPrice = parseFloat(order.price_per_unit) || 0;

        if (currentPrice <= 0 || limitPrice <= 0) {
          const msg = `Skipping order ${order.id}: Invalid prices - current: ${currentPrice}, limit: ${limitPrice}`;
          console.log(msg);
          logs.push(msg);
          continue;
        }

        // Check if limit condition is met
        let shouldExecute = false;
        let reason = '';

        // Ensure we're comparing numbers
        if (order.order_type === 'buy') {
          shouldExecute = currentPrice <= limitPrice;
          reason = `BUY Check: Cur($${currentPrice}) <= Limit($${limitPrice}) is ${shouldExecute}`;
        } else if (order.order_type === 'sell') {
          shouldExecute = currentPrice >= limitPrice;
          reason = `SELL Check: Cur($${currentPrice}) >= Limit($${limitPrice}) is ${shouldExecute}`;
        }

        logs.push(reason);

        if (shouldExecute) {
          console.log(`Executing ${order.order_type} limit order ${order.id} at price ${currentPrice}`);
          logs.push(`>> EXECUTING #${order.id}...`);

          // Update order with execution price (use current market price, not limit price)
          const executionPrice = currentPrice;
          const totalAmount = executionPrice * order.quantity;

          // Execute the order FIRST (update balance/holdings)
          // If this fails, the order status check logic will catch it and NOT mark it as completed
          await executeOrder(supabase, order.user_id, {
            ...order,
            price_per_unit: executionPrice,
            total_amount: totalAmount,
          }, executionPrice);

          // IF execution successful, THEN update order status
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
            console.error(`Failed to update order status ${order.id}`, updateError);
            logs.push(`Failed to update status for ${order.id}: ${updateError.message}`);
          } else {
            executedCount++;
            logs.push(`SUCCESS: Order ${order.id} executed!`);
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Order ${order.id}: ${errorMessage}`);
        logs.push(`ERROR executing ${order.id}: ${errorMessage}`);
        console.error(`Error processing order ${order.id}:`, error);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${pendingOrders.length} pending orders`,
      executed: executedCount,
      errors: errors.length > 0 ? errors : undefined,
      logs: logs // Return logs for debugging
    });
  } catch (error) {
    console.error('API Error in /api/orders/check-limits:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
