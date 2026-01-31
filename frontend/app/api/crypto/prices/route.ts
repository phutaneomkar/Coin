import { NextResponse } from 'next/server';
import { fetchCoinDCXTickers, fetchCoinDCXFuturesMarkets } from '../../../../lib/api/coindcx';
import { CryptoPrice } from '../../../../types';

// Cache futures list (static data) - not price data
let futuresInfoCache: { coins: Set<string>; timestamp: number } | null = null;
const FUTURES_CACHE_TTL = 300000; // 5 minutes

// Emergency cache for rate limit fallback only
let emergencyCache: { data: CryptoPrice[]; timestamp: number } | null = null;

export async function GET() {
  try {
    const now = Date.now();

    // Fetch CoinDCX Futures markets to filter for Future-listed coins
    let coindcxFuturesCoins = new Set<string>();
    if (futuresInfoCache && (now - futuresInfoCache.timestamp) < FUTURES_CACHE_TTL) {
      coindcxFuturesCoins = futuresInfoCache.coins;
    } else {
      try {
        const coins = await fetchCoinDCXFuturesMarkets();
        coindcxFuturesCoins = coins;
        futuresInfoCache = { coins, timestamp: now };
      } catch (error) {
        console.warn('Failed to fetch CoinDCX futures info:', error);
        if (futuresInfoCache) {
          coindcxFuturesCoins = futuresInfoCache.coins;
        }
      }
    }

    // Fetch all tickers from CoinDCX
    const tickers = await fetchCoinDCXTickers();

    // Filter only USDT pairs that are in CoinDCX futures
    const prices: CryptoPrice[] = tickers
      .filter((ticker) => {
        // Only USDT pairs
        if (!ticker.market.endsWith('USDT')) {
          return false;
        }

        const symbol = ticker.market.replace('USDT', '');

        // Must be in CoinDCX futures list
        if (coindcxFuturesCoins.size > 0 && !coindcxFuturesCoins.has(symbol)) {
          return false;
        }

        // Must have valid price
        const price = parseFloat(ticker.last_price) || 0;
        if (price <= 0) {
          return false;
        }

        return true;
      })
      .map((ticker) => {
        const symbol = ticker.market.replace('USDT', '');
        const currentPrice = parseFloat(ticker.last_price) || 0;
        const priceChangePercent24h = parseFloat(ticker.change_24_hour) || 0;
        const priceChange24h = currentPrice * (priceChangePercent24h / 100);
        const volume24h = parseFloat(ticker.volume) || 0;
        const high24h = parseFloat(ticker.high) || 0;
        const low24h = parseFloat(ticker.low) || 0;

        return {
          id: symbol.toLowerCase(),
          symbol: symbol,
          name: symbol,
          current_price: currentPrice,
          price_change_24h: priceChange24h,
          price_change_percentage_24h: priceChangePercent24h,
          price_change_percentage_3h: priceChangePercent24h, // CoinDCX only provides 24h, use as fallback
          market_cap: 0,
          volume_24h: volume24h,
          high_24h: high24h,
          low_24h: low24h,
          last_updated: new Date().toISOString(),
        };
      })
      .sort((a, b) => b.volume_24h - a.volume_24h); // Sort by volume since no market cap

    if (prices.length === 0) {
      throw new Error('No prices fetched from CoinDCX');
    }

    // Store in emergency cache for rate-limit fallback only
    emergencyCache = { data: prices, timestamp: Date.now() };

    return NextResponse.json(prices, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('API Error in /api/crypto/prices:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isRateLimit = errorMessage.includes('Rate limit') || errorMessage.includes('429');

    // Return stale cache only as absolute fallback
    if (isRateLimit && emergencyCache) {
      console.warn('Rate limited, returning emergency cached data');
      return NextResponse.json(emergencyCache.data, {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
          'X-Cache': 'STALE',
          'X-Rate-Limited': 'true',
        },
      });
    }

    return NextResponse.json(
      {
        error: isRateLimit ? 'Rate limit exceeded. Please try again later.' : 'Failed to fetch crypto prices',
        details: errorMessage,
        retryAfter: isRateLimit ? 60 : undefined,
      },
      {
        status: isRateLimit ? 429 : 500,
        headers: {
          'Content-Type': 'application/json',
          ...(isRateLimit && { 'Retry-After': '60' }),
        },
      }
    );
  }
}
