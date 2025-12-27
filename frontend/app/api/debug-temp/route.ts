import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        // Use default user ID if not logged in (for debugging)
        const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000000';
        const userId = user?.id || DEFAULT_USER_ID;

        const { data: holdings, error } = await supabase
            .from('holdings')
            .select('*')
            .eq('user_id', userId);

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const map = new Map();
        const duplicates: any[] = [];
        const debugData: any[] = [];

        holdings?.forEach(h => {
            // mimic the frontend logic: lowercase and trim
            const normalizedId = h.coin_id.toLowerCase().trim();
            debugData.push({
                original_id: h.coin_id,
                normalized_id: normalizedId,
                qty: h.quantity,
                symbol: h.coin_symbol // assuming this exists, if not we'll see
            });

            if (map.has(normalizedId)) {
                duplicates.push({
                    existing: map.get(normalizedId),
                    current: h,
                    normalizedKey: normalizedId
                });
            } else {
                map.set(normalizedId, h);
            }
        });

        const btcData = debugData.filter(d =>
            d.original_id.toLowerCase().includes('btc') ||
            d.original_id.toLowerCase().includes('bitcoin')
        );

        const text = btcData.map(d =>
            `ID: "${d.original_id}" | Sym: "${d.symbol || 'N/A'}" | Qty: ${d.qty}`
        ).join('\n');

        return new NextResponse(text, {
            status: 200,
            headers: { 'Content-Type': 'text/plain' }
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
