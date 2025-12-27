import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '../../../../lib/supabase/server';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { Holding, Order } from '../../../../types';
import { executeOrder } from '../../../../lib/services/orders';
import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { DEFAULT_USER_ID } from '../../../../lib/auth-utils';
import crypto from 'crypto';

const COINDCX_API_URL = process.env.COINDCX_API_URL || 'https://api.coindcx.com';
const TRADING_FEE_RATE = 0.001; // 0.1% trading fee

function generateSignature(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}



export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const hasAccess = cookieStore.get('app_access');

    if (!hasAccess) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = DEFAULT_USER_ID;
    const supabase = await createClient();

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
          .eq('id', userId)
          .single();

        if (!profile) {
          return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
        }

        // Include trading fee (0.1%)
        const tradingFee = totalAmount * 0.001;
        const totalWithFee = totalAmount + tradingFee;

        // Check for PENDING BUY orders to calculate "locked" balance
        const { data: pendingOrders } = await supabase
          .from('orders')
          .select('total_amount, quantity, price_per_unit')
          .eq('user_id', userId)
          .eq('order_status', 'pending')
          .eq('order_type', 'buy');

        // Calculate locked amount: sum of (price * quantity) + fees
        const lockedAmount = (pendingOrders || []).reduce((sum, o) => {
          // Use total_amount if available, otherwise estimate
          const amt = parseFloat(o.total_amount) || (parseFloat(o.quantity) * parseFloat(o.price_per_unit));
          const fee = amt * 0.001;
          return sum + amt + fee;
        }, 0);

        const currentBalance = parseFloat(profile.balance_inr.toString());
        const availableBalance = currentBalance - lockedAmount;

        console.log('PlaceOrder: balance check', { currentBalance, lockedAmount, availableBalance, req: totalWithFee });

        if (availableBalance < totalWithFee) {
          return NextResponse.json({
            error: 'Insufficient balance',
            details: `Balance: $${currentBalance.toFixed(2)}, Locked: $${lockedAmount.toFixed(2)}, Available: $${availableBalance.toFixed(2)}, Required: $${totalWithFee.toFixed(2)}`
          }, { status: 400 });
        }
      }

      // Validate holdings for sell orders - with case-insensitive matching
      if (orderData.side === 'sell') {
        const normalizedCoinId = (orderData.coin_id || '').toLowerCase().trim();

        // Check if user already has a pending sell order for this coin
        // User requested ability to place multiple sell orders if they have remaining quantity
        // The validation below (availableQty < quantity) already handles this.

        // First try with normalized coin_id
        let { data: holding, error: holdingError } = await supabase
          .from('holdings')
          .select('quantity, coin_id')
          .eq('user_id', userId)
          .eq('coin_id', normalizedCoinId)
          .maybeSingle();

        // If not found, try case-insensitive search directly in DB
        if (!holding && !holdingError) {
          const { data: ciHolding } = await supabase
            .from('holdings')
            .select('quantity, coin_id')
            .eq('user_id', userId)
            .ilike('coin_id', normalizedCoinId)
            .maybeSingle();
          if (ciHolding) {
            holding = ciHolding;
          }
        }

        const totalQty = holding ? parseFloat(holding.quantity.toString()) : 0;

        // Check for PENDING SELL orders to calculate "locked" amount
        const { data: pendingOrders } = await supabase
          .from('orders')
          .select('quantity')
          .eq('user_id', userId)
          .eq('order_status', 'pending')
          .eq('order_type', 'sell')
          .ilike('coin_id', normalizedCoinId); // Match coin ID case-insensitive

        const lockedQty = (pendingOrders || []).reduce((sum, o) => sum + (parseFloat(o.quantity) || 0), 0);
        const availableQty = totalQty - lockedQty;

        console.log('PlaceOrder: available check', { totalQty, lockedQty, availableQty, reqQty: quantity });

        if (availableQty < quantity) {
          return NextResponse.json({
            error: 'Insufficient holdings',
            details: `Total: ${totalQty}, Locked in Orders: ${lockedQty}, Available: ${availableQty}, Required: ${quantity}`
          }, { status: 400 });
        }
      }

      // For test mode, market orders are completed immediately
      // Limit orders remain pending until filled
      const orderStatus = isMarketOrder ? 'completed' : 'pending';

      // Save order to Supabase - normalize coin_id for consistency
      const normalizedCoinId = (orderData.coin_id || '').toLowerCase().trim();
      const { data: order, error } = await supabase
        .from('orders')
        .insert({
          user_id: userId,
          coin_id: normalizedCoinId, // Use normalized coin_id
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

      // Notify Rust Backend for Limit Orders
      if (orderStatus === 'pending') {
        try {
          console.log('Notifying Rust backend of new limit order:', order.id);
          // Don't await this, let it run in background/fail silently (fire and forget)
          const backendUrl = process.env.BACKEND_URL || (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:3002' : '');
          if (!backendUrl) {
            console.warn('BACKEND_URL not set, skipping rust backend notification');
            return; // Exit if no backend URL is available
          }
          fetch(`${backendUrl}/api/orders/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: order.id,
              user_id: userId,
              coin_id: normalizedCoinId,
              coin_symbol: orderData.coin_symbol,
              order_type: orderData.side, // "buy" or "sell"
              quantity: quantity,
              price: price,
              current_price: effectivePrice,
            })
          }).catch(e => console.error("Failed to notify Rust backend:", e));
        } catch (e) {
          console.error("Failed to setup notification to Rust backend:", e);
        }
      }

      // If order is completed (market order), execute it immediately
      if (orderStatus === 'completed') {
        console.log('Place order: Executing completed order', {
          orderId: order.id,
          orderType: order.order_type,
          coinId: order.coin_id,
          quantity: order.quantity,
        });
        try {
          await executeOrder(supabase, userId, order, effectivePrice);
          console.log('Place order: Order executed successfully');
        } catch (executeError) {
          console.error('Place order: Error executing order', executeError);
          // Return the error to the frontend so the user knows execution failed
          return NextResponse.json({
            success: true,
            order,
            warning: 'Order placed but execution failed. It may be processed later.',
            executionError: executeError instanceof Error ? executeError.message : 'Unknown execution error'
          });
        }
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

    const quantity = parseFloat(orderData.quantity) || 0;
    const price = orderData.price ? parseFloat(orderData.price) : null;
    const isMarketOrder = orderData.order_type === 'market_order';

    // Normalize coin_id for consistency
    const normalizedCoinId = (orderData.coin_id || '').toLowerCase().trim();

    // For production, check order status from API response
    const orderStatus = result.status === 'filled' || result.status === 'completed'
      ? 'completed'
      : (isMarketOrder ? 'completed' : 'pending');

    // Ensure we have a valid total amount
    let totalAmount = price && quantity
      ? price * quantity
      : quantity * (result.price || 100);

    // If totalAmount is effectively 0 due to precision, set a minimum or reject
    if (totalAmount <= 0) {
      console.warn('PlaceOrder: Total amount is 0 or negative', { quantity, price, resultPrice: result.price, totalAmount });
      if (quantity > 0) {
        totalAmount = Math.max(totalAmount, 0.00000001);
      }
    }

    console.log('PlaceOrder: Saving to DB', {
      userId,
      coinId: normalizedCoinId,
      quantity,
      totalAmount,
      status: orderStatus
    });

    if (totalAmount <= 0) {
      return NextResponse.json({ error: 'Order value is too small' }, { status: 400 });
    }

    const { error: dbError } = await supabase.from('orders').insert({
      user_id: userId,
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
