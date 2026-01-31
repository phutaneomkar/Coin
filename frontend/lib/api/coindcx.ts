export interface CoinDCXFuturesInstrument {
    pair: string;
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
    const response = await fetch('https://api.coindcx.com/exchange/ticker', {
        cache: 'no-store',
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

/**
 * Fetch CoinDCX futures ticker
 * Endpoint: https://api.coindcx.com/exchange/v1/derivatives/futures/data/ticker
 */
export async function fetchCoinDCXFuturesTicker(symbol: string): Promise<any | null> {
    try {
        const response = await fetch('https://api.coindcx.com/exchange/v1/derivatives/futures/data/ticker', {
            cache: 'no-store',
        });

        if (!response.ok) {
            return null;
        }

        const tickers = await response.json();
        const upperSymbol = symbol.toUpperCase();
        
        // Futures pairs are like "B-SYN_USDT"
        const futuresPair = `B-${upperSymbol}_USDT`;
        return tickers.find((t: any) => t.pair === futuresPair) || null;
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
