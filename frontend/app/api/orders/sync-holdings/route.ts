import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '../../../../lib/supabase/server';
import { createAdminClient } from '../../../../lib/supabase/admin';

// Global sync lock to prevent concurrent syncs
let isSyncing = false;
let syncPromise: Promise<any> | null = null;

/**
 * Sync holdings from existing completed buy orders
 * This is a one-time migration to backfill holdings for existing orders
 */
export async function POST(request: NextRequest) {
  // If already syncing, return the existing promise
  if (isSyncing && syncPromise) {
    return syncPromise;
  }

  isSyncing = true;
  syncPromise = (async () => {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        isSyncing = false;
        syncPromise = null;
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // Get all completed buy orders
      const { data: completedBuyOrders, error: ordersError } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', user.id)
        .eq('order_status', 'completed')
        .eq('order_type', 'buy')
        .order('order_date', { ascending: true });

      if (ordersError) {
        console.error('Error fetching orders:', ordersError);
        isSyncing = false;
        syncPromise = null;
        return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
      }

      if (!completedBuyOrders || completedBuyOrders.length === 0) {
        isSyncing = false;
        syncPromise = null;
        return NextResponse.json({
          success: true,
          message: 'No completed buy orders found',
          synced: 0,
          totalOrders: 0
        });
      }

      // Get all existing holdings
      const { data: existingHoldings, error: holdingsError } = await supabase
        .from('holdings')
        .select('*')
        .eq('user_id', user.id);

      if (holdingsError) {
        console.error('Error fetching holdings:', holdingsError);
        isSyncing = false;
        syncPromise = null;
        return NextResponse.json({ error: 'Failed to fetch holdings' }, { status: 500 });
      }

      // Create a map of existing holdings by normalized coin_id
      const holdingsMap = new Map<string, any>();
      if (existingHoldings) {
        existingHoldings.forEach(holding => {
          const normalizedId = (holding.coin_id || '').toLowerCase().trim();
          if (normalizedId) {
            holdingsMap.set(normalizedId, holding);
          }
        });
      }

      // Group orders by coin_id and aggregate
      const ordersByCoin = new Map<string, any[]>();
      completedBuyOrders.forEach(order => {
        const normalizedCoinId = (order.coin_id || '').toLowerCase().trim();
        if (normalizedCoinId) {
          if (!ordersByCoin.has(normalizedCoinId)) {
            ordersByCoin.set(normalizedCoinId, []);
          }
          ordersByCoin.get(normalizedCoinId)!.push(order);
        }
      });

      let synced = 0;
      const errors: string[] = [];

      // Process each coin
      for (const [normalizedCoinId, orders] of ordersByCoin.entries()) {
        try {
          // Calculate total quantity and average price
          let totalQuantity = 0;
          let totalCost = 0;
          let coinSymbol = '';

          orders.forEach(order => {
            const qty = parseFloat(order.quantity.toString());
            const amount = parseFloat(order.total_amount.toString());
            totalQuantity += qty;
            totalCost += amount;
            if (!coinSymbol && order.coin_symbol) {
              coinSymbol = order.coin_symbol;
            }
          });

          const averageBuyPrice = totalQuantity > 0 ? totalCost / totalQuantity : 0;

          // Check if holding already exists
          const existingHolding = holdingsMap.get(normalizedCoinId);

          if (existingHolding) {
            // Holding already exists - check if it needs updating
            // Only update if the calculated quantity from orders is different
            // This prevents duplicate syncing
            const existingQty = parseFloat(existingHolding.quantity.toString());

            // If quantities match (within small tolerance), skip update
            const qtyDiff = Math.abs(existingQty - totalQuantity);
            if (qtyDiff < 0.00000001) {
              continue; // Skip this coin, already synced
            }

            // Update existing holding - recalculate average price from all orders
            const existingAvgPrice = parseFloat(existingHolding.average_buy_price.toString());
            const existingCost = existingQty * existingAvgPrice;

            const newQuantity = totalQuantity; // Use calculated quantity from orders
            const newTotalCost = totalCost; // Use calculated cost from orders
            const newAveragePrice = newQuantity > 0 ? newTotalCost / newQuantity : averageBuyPrice;

            const { error: updateError } = await supabase
              .from('holdings')
              .update({
                quantity: newQuantity,
                average_buy_price: newAveragePrice,
                last_updated: new Date().toISOString(),
              })
              .eq('id', existingHolding.id);

            if (updateError) {
              errors.push(`Failed to update ${normalizedCoinId}: ${updateError.message}`);
            } else {
              synced++;
            }
          } else {
            // Create new holding
            let { error: insertError } = await supabase
              .from('holdings')
              .insert({
                user_id: user.id,
                coin_id: normalizedCoinId,
                coin_symbol: coinSymbol || normalizedCoinId.toUpperCase(),
                quantity: totalQuantity,
                average_buy_price: averageBuyPrice,
                last_updated: new Date().toISOString(),
              });

            // If RLS blocks it, try with admin client
            if (insertError && insertError.code === '42501') {
              try {
                const adminClient = createAdminClient();
                const { error: adminError } = await adminClient
                  .from('holdings')
                  .insert({
                    user_id: user.id,
                    coin_id: normalizedCoinId,
                    coin_symbol: coinSymbol || normalizedCoinId.toUpperCase(),
                    quantity: totalQuantity,
                    average_buy_price: averageBuyPrice,
                    last_updated: new Date().toISOString(),
                  });

                if (adminError) {
                  insertError = adminError;
                } else {
                  insertError = null;
                }
              } catch (adminErr) {
                // If admin client not available, use original error
                if (!(adminErr instanceof Error && adminErr.message.includes('SUPABASE_SERVICE_ROLE_KEY'))) {
                  insertError = adminErr as any;
                }
              }
            }

            if (insertError) {
              errors.push(`Failed to create ${normalizedCoinId}: ${insertError.message}`);
            } else {
              synced++;
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`Error processing ${normalizedCoinId}: ${errorMessage}`);
        }
      }

      const result = NextResponse.json({
        success: true,
        message: `Synced ${synced} holdings from ${completedBuyOrders.length} orders`,
        synced,
        totalOrders: completedBuyOrders.length,
        errors: errors.length > 0 ? errors : undefined,
      });

      isSyncing = false;
      syncPromise = null;
      return result;
    } catch (error) {
      console.error('Error syncing holdings:', error);
      isSyncing = false;
      syncPromise = null;
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  })();

  return syncPromise;
}
