import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '../../../../lib/supabase/server';
import { createAdminClient } from '../../../../lib/supabase/admin';

/**
 * Cleanup endpoint to remove zero-quantity holdings
 * POST /api/orders/cleanup-holdings
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all zero-quantity holdings
    const { data: zeroHoldings, error: fetchError } = await supabase
      .from('holdings')
      .select('id, coin_id, quantity')
      .eq('user_id', user.id)
      .lte('quantity', 0);

    if (fetchError) {
      console.error('Error fetching zero-quantity holdings:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch holdings', details: fetchError.message },
        { status: 500 }
      );
    }

    if (!zeroHoldings || zeroHoldings.length === 0) {
      return NextResponse.json({
        success: true,
        cleaned: 0,
        message: 'No zero-quantity holdings found',
      });
    }

    console.log('Cleanup: Found zero-quantity holdings to delete', {
      count: zeroHoldings.length,
      holdings: zeroHoldings,
    });

    // Try to delete with regular client first
    let deletedCount = 0;
    let failedDeletes: any[] = [];

    for (const holding of zeroHoldings) {
      const { error: deleteError, data: deleteData } = await supabase
        .from('holdings')
        .delete()
        .eq('id', holding.id)
        .select();

      if (!deleteError && deleteData && deleteData.length > 0) {
        deletedCount++;
        console.log('Cleanup: Deleted holding', { id: holding.id, coin_id: holding.coin_id });
      } else if (deleteError) {
        // If RLS blocks, try with admin client
        if (deleteError.code === '42501') {
          try {
            const adminClient = createAdminClient();
            const { error: adminError, data: adminData } = await adminClient
              .from('holdings')
              .delete()
              .eq('id', holding.id)
              .select();

            if (!adminError && adminData && adminData.length > 0) {
              deletedCount++;
              console.log('Cleanup: Deleted holding with admin client', { id: holding.id, coin_id: holding.coin_id });
            } else {
              failedDeletes.push({ holding, error: adminError });
            }
          } catch (adminErr) {
            failedDeletes.push({ holding, error: adminErr });
          }
        } else {
          failedDeletes.push({ holding, error: deleteError });
        }
      }
    }

    // If there are still failed deletes, try fallback: delete by coin_id
    if (failedDeletes.length > 0) {
      console.log('Cleanup: Trying fallback delete for failed holdings', { count: failedDeletes.length });

      try {
        const adminClient = createAdminClient();
        for (const { holding } of failedDeletes) {
          const normalizedCoinId = (holding.coin_id || '').toLowerCase().trim();
          const { error: fallbackError, data: fallbackData } = await adminClient
            .from('holdings')
            .delete()
            .eq('user_id', user.id)
            .ilike('coin_id', normalizedCoinId)
            .lte('quantity', 0)
            .select();

          if (!fallbackError && fallbackData && fallbackData.length > 0) {
            deletedCount++;
            console.log('Cleanup: Deleted holding with fallback method', { coin_id: normalizedCoinId, deleted: fallbackData.length });
          }
        }
      } catch (fallbackErr) {
        console.error('Cleanup: Fallback delete failed', fallbackErr);
      }
    }

    return NextResponse.json({
      success: true,
      cleaned: deletedCount,
      total: zeroHoldings.length,
      failed: failedDeletes.length,
      message: `Cleaned up ${deletedCount} zero-quantity holdings`,
    });
  } catch (error) {
    console.error('Error cleaning up holdings:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}




