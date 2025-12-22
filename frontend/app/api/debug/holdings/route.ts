import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Debug endpoint to check holdings and orders
 * GET /api/debug/holdings?coinId=btc
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

    const searchParams = request.nextUrl.searchParams;
    const coinId = searchParams.get('coinId');

    // Get all holdings
    const { data: allHoldings, error: holdingsError } = await supabase
      .from('holdings')
      .select('*')
      .eq('user_id', user.id);

    // Get all completed buy orders
    const { data: allOrders, error: ordersError } = await supabase
      .from('orders')
      .select('*')
      .eq('user_id', user.id)
      .eq('order_status', 'completed')
      .eq('order_type', 'buy');

    // If coinId provided, filter
    let filteredHoldings = allHoldings;
    let filteredOrders = allOrders;
    
    if (coinId) {
      const normalizedCoinId = coinId.toLowerCase().trim();
      filteredHoldings = allHoldings?.filter(
        h => h.coin_id?.toLowerCase() === normalizedCoinId
      ) || [];
      filteredOrders = allOrders?.filter(
        o => (o.coin_id || '').toLowerCase() === normalizedCoinId
      ) || [];
    }

    // Check for zero-quantity holdings that should be deleted
    const zeroQuantityHoldings = allHoldings?.filter(h => parseFloat(h.quantity.toString()) <= 0) || [];
    
    return NextResponse.json({
      success: true,
      user_id: user.id,
      search_coinId: coinId,
      all_holdings: allHoldings || [],
      all_orders: allOrders || [],
      filtered_holdings: filteredHoldings,
      filtered_orders: filteredOrders,
      holdings_count: allHoldings?.length || 0,
      orders_count: allOrders?.length || 0,
      zero_quantity_holdings: zeroQuantityHoldings,
      zero_quantity_count: zeroQuantityHoldings.length,
      errors: {
        holdings: holdingsError?.message,
        orders: ordersError?.message,
      },
      note: zeroQuantityHoldings.length > 0 
        ? `WARNING: Found ${zeroQuantityHoldings.length} holdings with 0 or negative quantity. These should be deleted.`
        : 'All holdings have quantity > 0',
    });
  } catch (error) {
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}






