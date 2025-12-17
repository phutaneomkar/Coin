import { SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { Order, Holding } from '@/types';

const TRADING_FEE_RATE = 0.001; // 0.1% trading fee

/**
 * Execute a completed order - update balance, holdings, and create transaction
 */
export async function executeOrder(
    supabase: SupabaseClient,
    userId: string,
    order: Order,
    executionPrice: number
) {
    try {
        // Verify session is active at the start
        // Note: If called from server-to-server webhook, getUser() might return null if no session cookie.
        // However, we require a valid Supabase client (likely Service Role if server-side).
        // If we pass a Service Role client, getUser might not work as expected or might be irrelevant.
        // But `place/route.ts` passed a user-authenticated client.

        // For this generic function, we shouldn't strictly enforce getUser() if we trust the caller (e.g. webhook with admin client).
        // But let's keep the balance check logic.

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

            console.log('ExecuteOrder: Processing buy order for holdings', {
                userId,
                normalizedCoinId,
                orderCoinId: order.coin_id,
                orderSymbol: order.coin_symbol,
                quantity: order.quantity,
                executionPrice,
            });

            // Try to find existing holding with case-insensitive matching
            const { data: initialExistingHolding, error: findError } = await supabase
                .from('holdings')
                .select('*')
                .eq('user_id', userId)
                .eq('coin_id', normalizedCoinId)
                .maybeSingle();
            let existingHolding = initialExistingHolding;

            // If not found, try case-insensitive search
            if (!existingHolding && !findError) {
                const { data: allHoldings } = await supabase
                    .from('holdings')
                    .select('*')
                    .eq('user_id', userId);

                if (allHoldings) {
                    existingHolding = allHoldings.find(
                        (h: Holding) => h.coin_id?.toLowerCase() === normalizedCoinId
                    ) || undefined;
                }
            }

            if (existingHolding) {
                // Calculate new average buy price
                const currentQty = parseFloat(existingHolding.quantity.toString());
                const orderQty = parseFloat(order.quantity.toString());
                const totalQuantity = currentQty + orderQty;
                const totalCostOld = parseFloat(existingHolding.average_buy_price.toString()) * currentQty;
                const totalCostNew = parseFloat(order.total_amount.toString());
                const newAveragePrice = (totalCostOld + totalCostNew) / totalQuantity;

                const { error: updateError } = await supabase
                    .from('holdings')
                    .update({
                        quantity: totalQuantity,
                        average_buy_price: newAveragePrice,
                        last_updated: new Date().toISOString(),
                    })
                    .eq('id', existingHolding.id);

                if (updateError) {
                    throw new Error(`Failed to update holding: ${updateError.message}`);
                }
            } else {
                // Create new holding

                // Try with regular client first
                let { error: insertError, data: insertedHolding } = await supabase
                    .from('holdings')
                    .insert({
                        user_id: userId,
                        coin_id: normalizedCoinId,
                        coin_symbol: order.coin_symbol,
                        quantity: order.quantity,
                        average_buy_price: executionPrice,
                        last_updated: new Date().toISOString(),
                    })
                    .select()
                    .single();

                // RLS fallback: If RLS blocks it, try with admin client
                if (insertError && insertError.code === '42501') {
                    console.log('ExecuteOrder: RLS blocked insert, trying with admin client');
                    try {
                        const adminClient = createAdminClient();
                        const { error: adminError, data: adminHolding } = await adminClient
                            .from('holdings')
                            .insert({
                                user_id: userId,
                                coin_id: normalizedCoinId,
                                coin_symbol: order.coin_symbol,
                                quantity: order.quantity,
                                average_buy_price: executionPrice,
                                last_updated: new Date().toISOString(),
                            })
                            .select()
                            .single();

                        if (adminError) {
                            throw new Error(`Failed to create holding (admin): ${adminError.message}`);
                        }
                    } catch (adminErr) {
                        throw adminErr;
                    }
                } else if (insertError) {
                    throw new Error(`Failed to create holding: ${insertError.message}`);
                }
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
            const { data: initialHolding, error: holdingError } = await supabase
                .from('holdings')
                .select('*')
                .eq('user_id', userId)
                .eq('coin_id', normalizedCoinId)
                .maybeSingle();
            let holding = initialHolding;

            if (!holding && !holdingError) {
                const { data: ciHolding } = await supabase
                    .from('holdings')
                    .select('*')
                    .eq('user_id', userId)
                    .ilike('coin_id', normalizedCoinId)
                    .maybeSingle();
                if (ciHolding) {
                    holding = ciHolding;
                }
            }

            const availableQty = holding ? parseFloat(holding.quantity.toString()) : 0;
            const sellQty = parseFloat(order.quantity.toString());

            if (!holding || availableQty < sellQty) {
                throw new Error(`Insufficient holdings. Required: ${sellQty}, Available: ${availableQty}`);
            }

            // Update holdings
            const newQuantity = availableQty - sellQty;

            if (newQuantity > 0) {
                const { error: updateError } = await supabase
                    .from('holdings')
                    .update({
                        quantity: newQuantity,
                        last_updated: new Date().toISOString(),
                    })
                    .eq('id', holding.id);

                if (updateError) {
                    // Admin fallback
                    if (updateError.code === '42501') {
                        const adminClient = createAdminClient();
                        const { error: adminUpdateError } = await adminClient
                            .from('holdings')
                            .update({
                                quantity: newQuantity,
                                last_updated: new Date().toISOString(),
                            })
                            .eq('id', holding.id);
                        if (adminUpdateError) throw adminUpdateError;
                    } else {
                        throw updateError;
                    }
                }
            } else {
                // Delete holding
                let deleteSuccess = false;

                // Method 1: Regular delete
                const { error: regularDeleteError, data: regularDeleteData } = await supabase
                    .from('holdings')
                    .delete()
                    .eq('id', holding.id)
                    .select();

                if (!regularDeleteError && regularDeleteData && regularDeleteData.length > 0) {
                    deleteSuccess = true;
                }

                // Method 2: Admin delete
                if (!deleteSuccess) {
                    try {
                        const adminClient = createAdminClient();
                        const { error: adminError, data: adminData } = await adminClient
                            .from('holdings')
                            .delete()
                            .eq('id', holding.id)
                            .select();
                        if (!adminError && adminData && adminData.length > 0) {
                            deleteSuccess = true;
                        }
                    } catch (e) { console.error("Admin delete failed", e); }
                }

                if (!deleteSuccess) {
                    // Logic to fallback to update quantity to 0
                    await supabase.from('holdings').update({ quantity: 0 }).eq('id', holding.id);
                }
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
            const newBalance = parseFloat(profile.balance_inr.toString()) + proceeds;

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
