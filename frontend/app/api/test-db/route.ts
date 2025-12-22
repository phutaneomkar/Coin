import { NextResponse } from 'next/server';
import { createClient } from '../../../lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const results: any = {
    connection: false,
    profile: false,
    watchlist: false,
    orders: false,
    tablesExist: false,
    errors: [],
    details: {},
  };

  try {
    // 1. Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      results.errors.push('Not authenticated. Please login first.');
      return NextResponse.json(results);
    }

    results.connection = true;
    results.details.user = { id: user.id, email: user.email };

    // 2. Check if tables exist by trying to query them
    try {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (profileError) {
        if (profileError.code === 'PGRST116') {
          results.errors.push('Profiles table does not exist. Please run the schema.sql in Supabase.');
        } else {
          results.errors.push(`Profile error: ${profileError.message} (Code: ${profileError.code})`);
        }
      } else if (profile) {
        results.profile = true;
        results.tablesExist = true;
        results.details.profile = {
          email: profile.email,
          balance: profile.balance_inr,
          kyc_status: profile.kyc_status,
        };
      }
    } catch (e: any) {
      results.errors.push(`Profile test failed: ${e.message}`);
    }

    // 3. Test Watchlist
    try {
      const { data: watchlist, error: watchlistError } = await supabase
        .from('watchlist')
        .select('*')
        .eq('user_id', user.id)
        .limit(1);

      if (watchlistError) {
        if (watchlistError.code === 'PGRST116') {
          results.errors.push('Watchlist table does not exist. Please run the schema.sql in Supabase.');
        } else {
          results.errors.push(`Watchlist error: ${watchlistError.message} (Code: ${watchlistError.code})`);
        }
      } else {
        results.watchlist = true;
        results.details.watchlistCount = watchlist?.length || 0;
      }
    } catch (e: any) {
      results.errors.push(`Watchlist test failed: ${e.message}`);
    }

    // 4. Test Orders
    try {
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', user.id)
        .limit(1);

      if (ordersError) {
        if (ordersError.code === 'PGRST116') {
          results.errors.push('Orders table does not exist. Please run the schema.sql in Supabase.');
        } else {
          results.errors.push(`Orders error: ${ordersError.message} (Code: ${ordersError.code})`);
        }
      } else {
        results.orders = true;
        results.details.ordersCount = orders?.length || 0;
      }
    } catch (e: any) {
      results.errors.push(`Orders test failed: ${e.message}`);
    }

    // 5. Test Insert (if tables exist)
    if (results.tablesExist) {
      try {
        const testCoinId = `test-${Date.now()}`;
        const { data: testWatchlist, error: insertError } = await supabase
          .from('watchlist')
          .insert({
            user_id: user.id,
            coin_id: testCoinId,
            coin_symbol: 'TEST',
          })
          .select()
          .single();

        if (insertError) {
          results.errors.push(`Insert test error: ${insertError.message} (Code: ${insertError.code})`);
        } else if (testWatchlist) {
          results.details.insertTest = 'SUCCESS';
          // Clean up
          await supabase.from('watchlist').delete().eq('id', testWatchlist.id);
        }
      } catch (e: any) {
        results.errors.push(`Insert test failed: ${e.message}`);
      }
    }

  } catch (error: any) {
    results.errors.push(`Test failed: ${error.message}`);
  }

  return NextResponse.json(results, { status: 200 });
}

