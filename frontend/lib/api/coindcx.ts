export interface CoinDCXFuturesInstrument {
    pair: string;
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
