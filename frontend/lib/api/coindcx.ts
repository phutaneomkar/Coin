export interface CoinDCXFuturesInstrument {
    pair: string;
}

export interface CoinDCXFuturesTicker {
    symbol: string;        // e.g. "B-SYN_USDT"
    last_price: string;    // e.g. "0.09930"
    bid: string;           // best bid
    ask: string;           // best ask
    change_24h: string;    // 24h change percent
    high_24h: string;
    low_24h: string;
    volume_24h: string;    // quantity
    timestamp: number;
}

export interface CoinDCXTicker {
    market: string;           // e.g., "SYNUSDT"
    change_24_hour: string;   // e.g., "-0.12"
    high: string;             // 24h high
    low: string;              // 24h low
    volume: string;           // 24h volume in base currency
    last_price: string;       // Current price
    bid: string;              // Best bid
    ask: string;              // Best ask
    timestamp: number;
}

/**
 * Fetch all CoinDCX tickers (spot markets)
 * Endpoint: https://api.coindcx.com/exchange/ticker
 */
export async function fetchCoinDCXTickers(): Promise<CoinDCXTicker[]> {
    const url = `https://api.coindcx.com/exchange/ticker?_=${Date.now()}`;
    const response = await fetch(url, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
    });

    if (!response.ok) {
        throw new Error(`CoinDCX API error: ${response.statusText}`);
    }

    return response.json();
}

/**
 * Fetch a specific CoinDCX ticker by market pair
 * @param symbol - e.g., "SYN" or "BTC"
 */
export async function fetchCoinDCXTickerBySymbol(symbol: string): Promise<CoinDCXTicker | null> {
    const tickers = await fetchCoinDCXTickers();
    const upperSymbol = symbol.toUpperCase();

    // Try USDT pair first (most common)
    const usdtMarket = `${upperSymbol}USDT`;
    let ticker = tickers.find(t => t.market === usdtMarket);

    if (!ticker) {
        // Try INR pair
        const inrMarket = `${upperSymbol}INR`;
        ticker = tickers.find(t => t.market === inrMarket);
    }

    if (!ticker) {
        // Try partial match
        ticker = tickers.find(t => t.market.startsWith(upperSymbol));
    }

    return ticker || null;
}

/** Futures data from public.coindcx.com (matches coindcx.com/futures page) */
export interface CoinDCXFuturesData {
    pair: string;           // e.g. "B-SYN_USDT"
    last_price: number;     // from last trade
    bid: number;            // best bid
    ask: number;            // best ask
    high_24h: number;
    low_24h: number;
    volume_24h: number;
    change_24_hour?: number; // percent
}

const PUBLIC_COINDCX = 'https://public.coindcx.com';

/** CoinDCX orderbook format: { bids: { "price": "qty" }, asks: { "price": "qty" } } */
export interface CoinDCXOrderBook {
    bids: Record<string, string>;
    asks: Record<string, string>;
}

/**
 * Fetch orderbook from CoinDCX (B-SYMBOL_USDT) - same source as coindcx.com/futures
 */
export async function fetchCoinDCXOrderbook(symbol: string): Promise<CoinDCXOrderBook | null> {
    const pair = `B-${symbol.toUpperCase()}_USDT`;
    try {
        const res = await fetch(`${PUBLIC_COINDCX}/market_data/orderbook?pair=${pair}&_=${Date.now()}`, {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' },
        });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

/**
 * Fetch CoinDCX futures/perpetual data (B-SYMBOL_USDT)
 * Uses public.coindcx.com - matches prices on coindcx.com/futures
 */
export async function fetchCoinDCXFuturesData(symbol: string): Promise<CoinDCXFuturesData | null> {
    const upperSymbol = symbol.toUpperCase();
    const pair = `B-${upperSymbol}_USDT`;

    try {
        // Orderbook is the reliable futures source. Trade history for B-SYN_USDT returns spot data (wrong).
        const [orderbookRes, candlesRes] = await Promise.all([
            fetch(`${PUBLIC_COINDCX}/market_data/orderbook?pair=${pair}`, { cache: 'no-store' }),
            fetch(`${PUBLIC_COINDCX}/market_data/candles?pair=${pair}&interval=1h&limit=24`, { cache: 'no-store' }),
        ]);

        if (!orderbookRes.ok) return null;

        const orderbook = await orderbookRes.json();
        const bids = orderbook.bids || {};
        const asks = orderbook.asks || {};
        const bidPrices = Object.keys(bids).map(Number).filter(Boolean).sort((a, b) => b - a);
        const askPrices = Object.keys(asks).map(Number).filter(Boolean).sort((a, b) => a - b);
        const bestBid = bidPrices[0] ?? 0;
        const bestAsk = askPrices[0] ?? 0;
        // Use mid-price from orderbook - matches coindcx.com/futures display
        const lastPrice = (bestBid && bestAsk) ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;

        let high24h = 0;
        let low24h = 0;
        let volume24h = 0;
        let change24h: number | undefined;

        if (candlesRes.ok) {
            const candles = await candlesRes.json();
            if (Array.isArray(candles) && candles.length > 0) {
                const lows = candles.map((c: { low?: number }) => c.low ?? 0).filter((v: number) => v > 0);
                high24h = Math.max(...candles.map((c: { high?: number }) => c.high ?? 0));
                low24h = lows.length > 0 ? Math.min(...lows) : lastPrice;
                volume24h = candles.reduce((s: number, c: { volume?: number }) => s + (c.volume ?? 0), 0);
                const oldest = candles[candles.length - 1];
                const open24h = oldest?.open ?? lastPrice;
                if (open24h > 0) {
                    change24h = ((lastPrice - open24h) / open24h) * 100;
                }
            }
        }

        return {
            pair,
            last_price: lastPrice,
            bid: bestBid,
            ask: bestAsk,
            high_24h: high24h || lastPrice,
            low_24h: low24h || lastPrice,
            volume_24h: volume24h,
            change_24_hour: change24h,
        };
    } catch {
        return null;
    }
}


/**
 * Fetch CoinDCX Active Futures Instruments
 * Endpoint: https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments
 */
export async function fetchCoinDCXFuturesMarkets(): Promise<Set<string>> {
    try {
        const response = await fetch('https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT', {
            next: { revalidate: 3600 }, // Cache for 1 hour
        });

        if (!response.ok) {
            throw new Error(`CoinDCX API error: ${response.statusText}`);
        }

        const data: string[] = await response.json();

        // Extract base assets from pairs like "B-BTC_USDT" -> "BTC"
        const futuresCoins = new Set<string>();

        data.forEach(pair => {
            // Format is typically B-BASE_QUOTE or just BASE_QUOTE logic
            // The provided list shows formats like "B-BTC_USDT", "B-ETH_USDT"
            // We want to extract "BTC", "ETH"

            const parts = pair.split('_');
            if (parts.length >= 2) {
                let base = parts[0]; // "B-BTC"
                if (base.startsWith('B-')) {
                    base = base.substring(2); // "BTC"
                }

                // Handle cases like "1000SHIB" -> "SHIB" (optional, but standardizes to the coin)
                // If the spot lists "SHIB", but futures is "1000SHIB", we want to match SHIB.
                if (base.startsWith('1000')) {
                    // Keep both "1000SHIB" and "SHIB" to be safe?
                    // Or just strip it? Let's strip it to match the underlying asset.
                    const stripped = base.replace('1000', '');
                    // Avoid stripping if it's just numbers but unlikely for these coins
                    if (stripped.length > 0) {
                        futuresCoins.add(stripped);
                    }
                }

                futuresCoins.add(base);
            }
        });

        return futuresCoins;
    } catch (error) {
        console.error('Failed to fetch CoinDCX futures markets:', error);
        return new Set<string>(); // Return empty set on error to avoid breaking the app (or allow all?)
    }
}

/**
 * Fetch all CoinDCX futures tickers (B- pairs)
 * Endpoint: https://api.coindcx.com/exchange/v1/derivatives/futures/data/tickers
 * This is the source for real-time LTP shown on coindcx.com/futures
 */
export async function fetchCoinDCXFuturesTickers(): Promise<CoinDCXFuturesTicker[]> {
    try {
        const response = await fetch('https://api.coindcx.com/exchange/v1/derivatives/futures/data/tickers', {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
        });

        if (!response.ok) {
            return [];
        }

        return await response.json();
    } catch (error) {
        console.error('Failed to fetch CoinDCX futures tickers:', error);
        return [];
    }
}
