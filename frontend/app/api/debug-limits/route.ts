
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const COIN_TO_BINANCE_SYMBOL: Record<string, string> = {
    'bitcoin': 'BTCUSDT',
};

function getBinanceSymbol(coinId: string): string {
    const lowerCoinId = coinId.trim().toLowerCase();
    const mapped = COIN_TO_BINANCE_SYMBOL[lowerCoinId];
    if (mapped) return mapped;
    return lowerCoinId.replace(/-/g, '').toUpperCase() + 'USDT';
}

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const userId = '00000000-0000-0000-0000-000000000000';

        const { data: pendingOrders, error } = await supabase
            .from('orders')
            .select('*')
            .eq('user_id', userId)
            .eq('order_status', 'pending')
            .eq('order_mode', 'limit');

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        const logs: string[] = [];

        for (const order of pendingOrders) {
            const coinId = order.coin_id;
            if (!coinId.toLowerCase().includes('btc') && !coinId.toLowerCase().includes('bitcoin')) {
                continue;
            }

            const { data: holding } = await supabase
                .from('holdings')
                .select('*')
                .eq('user_id', userId)
                .eq('coin_id', coinId)
                .maybeSingle();

            const status = holding ? `FOUND (${holding.quantity})` : 'MISSING';
            logs.push(`Order #${order.id} | Coin: ${coinId} | Holding: ${status}`);

            if (!holding) {
                const { data: allHoldings } = await supabase
                    .from('holdings')
                    .select('coin_id, quantity')
                    .eq('user_id', userId);
                const btcHolding = allHoldings?.find(h => h.coin_id.includes('btc') || h.coin_id.includes('bitcoin'));
                if (btcHolding) {
                    logs.push(`ALTERNATIVE: ${btcHolding.coin_id} (${btcHolding.quantity})`);
                }
            }
        }

        return NextResponse.json({ logs });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
