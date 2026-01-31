import { NextResponse } from 'next/server';
import { fetchCoinDCXTickers, fetchCoinDCXFuturesMarkets, fetchCoinDCXFuturesTickers, CoinDCXFuturesTicker } from '../../../../lib/api/coindcx';
import { CryptoPrice } from '../../../../types';

export const dynamic = 'force-dynamic';

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

    // B-SYMBOL_USDT = Binance futures - use CoinDCX Bulk Futures for prices (matches CoinDCX futures display)
    const [coindcxFuturesTickers, coinDcxSpotTickers] = await Promise.all([
      fetchCoinDCXFuturesTickers(),
      fetchCoinDCXTickers(),
    ]);

    const cfMap = new Map<string, CoinDCXFuturesTicker>(coindcxFuturesTickers.map((t) => [t.symbol, t]));

    const prices: CryptoPrice[] = [];
    const seenSymbols = new Set<string>();

    // 1. Build from CoinDCX Futures first (LTP matches coindcx.com/futures exactly)
    for (const symbol of coindcxFuturesCoins) {
      const cfSymbol = `B-${symbol}_USDT`;
      const cf = cfMap.get(cfSymbol);
      if (cf) {
        const currentPrice = parseFloat(cf.last_price) || 0;
        if (currentPrice > 0) {
          const priceChangePercent24h = parseFloat(cf.change_24h) || 0;
          seenSymbols.add(symbol);
          prices.push({
            id: symbol.toLowerCase(),
            symbol: symbol,
            name: symbol,
            current_price: currentPrice,
            price_change_24h: currentPrice * (priceChangePercent24h / 100),
            price_change_percentage_24h: priceChangePercent24h,
            price_change_percentage_3h: priceChangePercent24h,
            market_cap: 0,
            volume_24h: parseFloat(cf.volume_24h) || 0,
            high_24h: parseFloat(cf.high_24h) || currentPrice,
            low_24h: parseFloat(cf.low_24h) || currentPrice,
            last_updated: new Date().toISOString(),
          });
        }
      }
    }

    // 2. Fallback: CoinDCX spot for symbols not in futures (or not matched in B- pairs)
    for (const ticker of coinDcxSpotTickers) {
      if (!ticker.market.endsWith('USDT')) continue;
      const symbol = ticker.market.replace('USDT', '');
      if (seenSymbols.has(symbol)) continue;
      if (coindcxFuturesCoins.size > 0 && !coindcxFuturesCoins.has(symbol)) continue;

      const currentPrice = parseFloat(ticker.last_price) || 0;
      if (currentPrice <= 0) continue;
      const priceChangePercent24h = parseFloat(ticker.change_24_hour) || 0;
      seenSymbols.add(symbol);
      prices.push({
        id: symbol.toLowerCase(),
        symbol: symbol,
        name: symbol,
        current_price: currentPrice,
        price_change_24h: currentPrice * (priceChangePercent24h / 100),
        price_change_percentage_24h: priceChangePercent24h,
        price_change_percentage_3h: priceChangePercent24h,
        market_cap: 0,
        volume_24h: parseFloat(ticker.volume) || 0,
        high_24h: parseFloat(ticker.high) || currentPrice,
        low_24h: parseFloat(ticker.low) || currentPrice,
        last_updated: new Date().toISOString(),
      });
    }

    prices.sort((a, b) => b.volume_24h - a.volume_24h);

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
