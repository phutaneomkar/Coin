
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Load env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Mock Binance functions locally to verify logic
const COIN_TO_BINANCE_SYMBOL: Record<string, string> = {
    'bitcoin': 'BTCUSDT',
    'ethereum': 'ETHUSDT',
    // ... (simplified)
};

function getBinanceSymbol(coinId: string): string {
    const lowerCoinId = coinId.trim().toLowerCase();
    const mapped = COIN_TO_BINANCE_SYMBOL[lowerCoinId];
    if (mapped) return mapped;
    return lowerCoinId.replace(/-/g, '').toUpperCase() + 'USDT';
}

async function fetchBinanceTicker(symbol: string) {
    // Fetch directly from Binance API
    const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
    if (!res.ok) throw new Error(`Binance API Error: ${res.statusText}`);
    return res.json();
}

async function checkLimits() {
    console.log('--- Checking Limit Orders ---');

    const { data: pendingOrders, error } = await supabase
        .from('orders')
        .select('*')
        .eq('order_status', 'pending')
        .eq('order_mode', 'limit');

    if (error) {
        console.error('Error fetching orders:', error);
        return;
    }

    console.log(`Found ${pendingOrders.length} pending limit orders.`);

    for (const order of pendingOrders) {
        console.log(`\nOrder ${order.id}: ${order.order_type.toUpperCase()} ${order.quantity} ${order.coin_symbol} @ ${order.price_per_unit}`);
        const coinId = order.coin_id;
        const binanceSymbol = getBinanceSymbol(coinId);
        console.log(`Resolved Symbol: ${coinId} -> ${binanceSymbol}`);

        try {
            const ticker = await fetchBinanceTicker(binanceSymbol);
            const currentPrice = parseFloat(ticker.lastPrice);
            const limitPrice = parseFloat(order.price_per_unit);

            console.log(`Current Price: ${currentPrice}`);
            console.log(`Limit Price: ${limitPrice}`);

            let shouldExecute = false;
            if (order.order_type === 'buy') {
                shouldExecute = currentPrice <= limitPrice;
                console.log(`Check BUY: ${currentPrice} <= ${limitPrice} = ${shouldExecute}`);
            } else if (order.order_type === 'sell') {
                shouldExecute = currentPrice >= limitPrice;
                console.log(`Check SELL: ${currentPrice} >= ${limitPrice} = ${shouldExecute}`);
            }

            if (shouldExecute) {
                console.log('>>> WOULD EXECUTE <<<');
            } else {
                console.log('>>> CONDITIONS NOT MET <<<');
            }

        } catch (e: any) {
            console.error(`Error checking price: ${e.message}`);
        }
    }
}

checkLimits();
