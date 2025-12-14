import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import crypto from 'crypto';

const COINDCX_API_URL = process.env.COINDCX_API_URL || 'https://api.coindcx.com';
const TRADING_FEE_RATE = 0.001; // 0.1% trading fee

function generateSignature(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

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
        .single();

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

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const useTestAPI = process.env.USE_TEST_API === 'true' || process.env.NODE_ENV === 'development';

    if (useTestAPI) {
      // In test mode, just simulate order placement and save to database
      const orderData = await request.json();
      
      // Calculate total amount
      const quantity = parseFloat(orderData.quantity) || 0;
      if (quantity <= 0) {
        return NextResponse.json({ error: 'Invalid quantity' }, { status: 400 });
      }
      
      const price = orderData.price ? parseFloat(orderData.price) : null;
      const isMarketOrder = orderData.order_type === 'market_order';
      
      // For market orders, try to get current price from request or use estimated price
      // The frontend should send current_price in the request
      const currentPrice = orderData.current_price ? parseFloat(orderData.current_price) : null;
      const effectivePrice = price || currentPrice || 100; // Fallback to ₹100 if no price
      
      const totalAmount = effectivePrice * quantity;
      
      if (totalAmount <= 0) {
        return NextResponse.json({ error: 'Total amount must be greater than 0' }, { status: 400 });
      }
      
      // Validate balance for buy orders
      if (orderData.side === 'buy') {
        const { data: profile } = await supabase
          .from('profiles')
          .select('balance_inr')
          .eq('id', user.id)
          .single();

        if (!profile) {
          return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
        }

        // Include trading fee (0.1%)
        const tradingFee = totalAmount * 0.001;
        const totalWithFee = totalAmount + tradingFee;

        if (profile.balance_inr < totalWithFee) {
          return NextResponse.json({ 
            error: 'Insufficient balance',
            details: `Required: $${totalWithFee.toFixed(2)}, Available: $${profile.balance_inr.toFixed(2)}`
          }, { status: 400 });
        }
      }

      // Validate holdings for sell orders - with case-insensitive matching
      if (orderData.side === 'sell') {
        const normalizedCoinId = (orderData.coin_id || '').toLowerCase().trim();
        
        // First try with normalized coin_id
        let { data: holding, error: holdingError } = await supabase
          .from('holdings')
          .select('quantity, coin_id')
          .eq('user_id', user.id)
          .eq('coin_id', normalizedCoinId)
          .maybeSingle();

        // If not found, try case-insensitive search
        if (!holding && !holdingError) {
          const { data: allHoldings } = await supabase
            .from('holdings')
            .select('quantity, coin_id')
            .eq('user_id', user.id);

          if (allHoldings) {
            holding = allHoldings.find(
              h => h.coin_id?.toLowerCase() === normalizedCoinId
            );
          }
        }

        const availableQty = holding ? parseFloat(holding.quantity.toString()) : 0;
        
        if (!holding || availableQty < quantity) {
          return NextResponse.json({ 
            error: 'Insufficient holdings',
            details: `Required: ${quantity}, Available: ${availableQty}`
          }, { status: 400 });
        }
      }

      // For test mode, market orders are completed immediately
      // Limit orders remain pending until filled
      const orderStatus = isMarketOrder ? 'completed' : 'pending';
      
      // Save order to Supabase
      const { data: order, error } = await supabase
        .from('orders')
        .insert({
          user_id: user.id,
          coin_id: orderData.coin_id,
          coin_symbol: orderData.coin_symbol,
          order_type: orderData.side,
          order_mode: isMarketOrder ? 'market' : 'limit',
          order_status: orderStatus,
          quantity: quantity,
          price_per_unit: price || (isMarketOrder ? effectivePrice : effectivePrice),
          total_amount: totalAmount,
        })
        .select()
        .single();

      if (error) {
        console.error('Order insert error:', error);
        return NextResponse.json({ 
          error: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint 
        }, { status: 400 });
      }

      // If order is completed (market order), execute it immediately
      if (orderStatus === 'completed') {
        await executeOrder(supabase, user.id, order, effectivePrice);
      }

      return NextResponse.json({ success: true, order });
    }

    // Production: Use COINDCX API
    const apiKey = process.env.COINDCX_API_KEY;
    const apiSecret = process.env.COINDCX_API_SECRET;

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { error: 'COINDCX API credentials not configured' },
        { status: 500 }
      );
    }

    const orderData = await request.json();
    const body = JSON.stringify(orderData);
    const signature = generateSignature(apiSecret, body);

    const response = await fetch(`${COINDCX_API_URL}/exchange/v1/orders/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AUTH-APIKEY': apiKey,
        'X-AUTH-SIGNATURE': signature,
      },
      body,
    });

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json({ error: error.message || 'Failed to place order' }, { status: 400 });
    }

    const result = await response.json();

    // Save order to Supabase
    const quantity = parseFloat(orderData.quantity) || 0;
    const price = orderData.price ? parseFloat(orderData.price) : null;
    const isMarketOrder = orderData.order_type === 'market_order';
    const totalAmount = price && quantity 
      ? price * quantity 
      : quantity * (result.price || 100); // Use price from API response or fallback
    
    // For production, check order status from API response
    const orderStatus = result.status === 'filled' || result.status === 'completed' 
      ? 'completed' 
      : (isMarketOrder ? 'completed' : 'pending');
    
    // Normalize coin_id for consistency
    const normalizedCoinId = (orderData.coin_id || '').toLowerCase().trim();
    const { error: dbError } = await supabase.from('orders').insert({
      user_id: user.id,
      coin_id: normalizedCoinId, // Use normalized coin_id
      coin_symbol: orderData.coin_symbol,
      order_type: orderData.side,
      order_mode: isMarketOrder ? 'market' : 'limit',
      order_status: orderStatus,
      quantity: quantity,
      price_per_unit: price,
      total_amount: totalAmount,
    });
    
    if (dbError) {
      console.error('Failed to save order to database:', dbError);
      // Don't fail the request, order was placed on exchange
    }

    return NextResponse.json({ success: true, order: result });
  } catch (error) {
    console.error('Error placing order:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

