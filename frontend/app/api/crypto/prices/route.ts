import { NextResponse } from 'next/server';
import { fetchBinanceTickers, fetchBinanceExchangeInfo, getCoinIdFromSymbol, fetch3hChangePercent } from '../../../../lib/api/binance';
import { fetchCoinDCXFuturesMarkets } from '../../../../lib/api/coindcx';
import { CryptoPrice } from '../../../../types';

// Use mainnet for market data to get all available coins
// Testnet only has ~20 trading pairs, mainnet has thousands
const BINANCE_API_BASE = process.env.NEXT_PUBLIC_BINANCE_USE_TESTNET === 'true'
  ? 'https://testnet.binance.vision/api'
  : 'https://api.binance.com/api';

// Simple in-memory cache to prevent excessive API calls
interface CacheEntry {
  data: CryptoPrice[];
  timestamp: number;
}

interface ExchangeInfoCache {
  data: { symbols: Array<{ symbol: string; status: string; isSpotTradingAllowed: boolean }> };
  timestamp: number;
}

interface FuturesInfoCache {
  coins: Set<string>;
  timestamp: number;
}

let cache: CacheEntry | null = null;
let exchangeInfoCache: ExchangeInfoCache | null = null;
let futuresInfoCache: FuturesInfoCache | null = null;
const CACHE_TTL = 5000; // Cache for 5 seconds
const EXCHANGE_INFO_CACHE_TTL = 300000; // Cache exchange info for 5 minutes (it doesn't change often)

// Known CoinDCX banned/delisted coins or coins in exit mode
// This list should be updated periodically based on CoinDCX announcements
const COINDCX_BANNED_COINS = new Set([
  'luna', 'lunausdt', // Terra LUNA
  'ust', 'ustusdt', // Terra UST
  'anc', 'ancusdt', // Anchor Protocol
  'mir', 'mirusdt', // Mirror Protocol
  // Add more banned/delisted coins as needed
]);

// Binance statuses that indicate the coin is not tradable
// These statuses mean the coin is in exit mode, halted, or not available for trading
const NON_TRADABLE_STATUSES = new Set([
  'BREAK',           // Trading is broken
  'PRE_TRADING',     // Pre-trading (not yet active)
  'POST_TRADING',    // Post-trading (after market closes)
  'END_OF_DAY',      // End of day
  'HALT',            // Trading halted
  'AUCTION_MATCH',   // Auction matching
]);

export async function GET() {
  try {
    // Check cache first
    const now = Date.now();
    if (cache && (now - cache.timestamp) < CACHE_TTL) {
      return NextResponse.json(cache.data, {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=10',
          'Content-Type': 'application/json',
          'X-Cache': 'HIT',
        },
      });
    }

    // Fetch all 24hr tickers from Binance with retry logic
    const tickers = await fetchBinanceTickers(3);

    // Fetch exchange info to check trading status for each symbol
    // Use cache to avoid excessive API calls
    let exchangeInfo: { symbols: Array<{ symbol: string; status: string; isSpotTradingAllowed: boolean }> } | null = null;

    if (exchangeInfoCache && (now - exchangeInfoCache.timestamp) < EXCHANGE_INFO_CACHE_TTL) {
      exchangeInfo = exchangeInfoCache.data;
    } else {
      try {
        const fetchedInfo = await fetchBinanceExchangeInfo();
        exchangeInfo = fetchedInfo;
        // Update cache
        exchangeInfoCache = {
          data: fetchedInfo,
          timestamp: now,
        };
      } catch (error) {
        console.warn('Failed to fetch exchange info, will filter based on price only:', error);
        // Use stale cache if available
        if (exchangeInfoCache) {
          exchangeInfo = exchangeInfoCache.data;
        }
      }
    }

    // Fetch CoinDCX Futures markets to filter for Future-listed coins
    let coindcxFuturesCoins = new Set<string>();
    if (futuresInfoCache && (now - futuresInfoCache.timestamp) < EXCHANGE_INFO_CACHE_TTL) {
      coindcxFuturesCoins = futuresInfoCache.coins;
    } else {
      try {
        const coins = await fetchCoinDCXFuturesMarkets();
        coindcxFuturesCoins = coins;
        futuresInfoCache = {
          coins: coins,
          timestamp: now
        };
      } catch (error) {
        console.warn('Failed to fetch CoinDCX futures info:', error);
        if (futuresInfoCache) {
          coindcxFuturesCoins = futuresInfoCache.coins;
        }
      }
    }

    // Create a map of symbol -> status for quick lookup
    const symbolStatusMap = new Map<string, { status: string; isSpotTradingAllowed: boolean }>();
    if (exchangeInfo) {
      exchangeInfo.symbols.forEach((symbolInfo) => {
        symbolStatusMap.set(symbolInfo.symbol, {
          status: symbolInfo.status,
          isSpotTradingAllowed: symbolInfo.isSpotTradingAllowed,
        });
      });
    }

    // Filter only USDT pairs and convert to our format
    // Include ALL USDT pairs, not just mapped ones
    const prices: CryptoPrice[] = tickers
      .filter((ticker) => {
        // First, only process USDT pairs
        if (!ticker.symbol.endsWith('USDT')) {
          return false;
        }

        const coinSymbol = ticker.symbol.replace('USDT', '');

        // FILTER: Must be listed on CoinDCX Futures
        // Check if the BASE token (e.g. BTC) is in our CoinDCX futures list
        if (coindcxFuturesCoins.size > 0 && !coindcxFuturesCoins.has(coinSymbol)) {
          return false;
        }

        // Check if coin is banned by CoinDCX
        const coinSymbolLower = coinSymbol.toLowerCase();
        const coinId = getCoinIdFromSymbol(ticker.symbol)?.toLowerCase() || coinSymbolLower;
        if (COINDCX_BANNED_COINS.has(coinId) || COINDCX_BANNED_COINS.has(coinSymbolLower) || COINDCX_BANNED_COINS.has(ticker.symbol.toLowerCase())) {
          return false;
        }

        // Check Binance trading status
        const symbolInfo = symbolStatusMap.get(ticker.symbol);
        if (symbolInfo) {
          // Exclude if status indicates non-tradable (exit mode, halted, etc.)
          if (NON_TRADABLE_STATUSES.has(symbolInfo.status)) {
            return false;
          }
          // Exclude if spot trading is not allowed
          if (!symbolInfo.isSpotTradingAllowed) {
            return false;
          }
        }

        // Exclude coins with zero or invalid price
        const price = parseFloat(ticker.lastPrice) || 0;
        if (price <= 0) {
          return false;
        }

        return true;
      })
      .map((ticker) => {
        // Try to get coin ID from mapping first, otherwise generate from symbol
        let coinId = getCoinIdFromSymbol(ticker.symbol);
        const symbol = ticker.symbol.replace('USDT', '');

        // If not in mapping, create coin ID from symbol (lowercase)
        if (!coinId) {
          coinId = symbol.toLowerCase();
        }

        const currentPrice = parseFloat(ticker.lastPrice) || 0;
        const priceChange24h = parseFloat(ticker.priceChange) || 0;
        const priceChangePercent24h = parseFloat(ticker.priceChangePercent) || 0;
        const volume24h = parseFloat(ticker.quoteVolume) || 0;
        // Binance doesn't provide market cap directly, estimate from volume
        const marketCap = currentPrice * parseFloat(ticker.volume) || 0;

        return {
          id: coinId,
          symbol: symbol,
          name: symbol, // Use symbol as name
          current_price: currentPrice,
          price_change_24h: priceChange24h,
          price_change_percentage_24h: priceChangePercent24h,
          market_cap: marketCap,
          volume_24h: volume24h,
          last_updated: new Date().toISOString(),
          binanceSymbol: ticker.symbol,
        };
      })

      .sort((a, b) => b.market_cap - a.market_cap); // Sort by market cap

    // Fetch 3h change % in batches (Binance rate limit)
    type PriceWithSymbol = CryptoPrice & { binanceSymbol: string };
    const BATCH_SIZE = 15;
    const pricesWith3h: CryptoPrice[] = [];
    for (let i = 0; i < prices.length; i += BATCH_SIZE) {
      const batch = prices.slice(i, i + BATCH_SIZE) as PriceWithSymbol[];
      const results = await Promise.all(
        batch.map(async (p) => {
          const threeH = await fetch3hChangePercent(p.binanceSymbol, p.current_price);
          const { binanceSymbol: _, ...rest } = p;
          return {
            ...rest,
            ...(threeH != null && { price_change_percentage_3h: threeH }),
          };
        })
      );
      pricesWith3h.push(...results);
    }

    if (pricesWith3h.length === 0) {
      throw new Error('No prices fetched from Binance');
    }

    // Update cache
    cache = {
      data: pricesWith3h,
      timestamp: Date.now(),
    };

    return NextResponse.json(pricesWith3h, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=10', // Cache for 5 seconds
        'Content-Type': 'application/json',
        'X-Cache': 'MISS',
      },
    });
  } catch (error) {
    console.error('API Error in /api/crypto/prices:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isRateLimit = errorMessage.includes('Rate limit') ||
      errorMessage.includes('429') ||
      errorMessage.includes('418') ||
      errorMessage.includes('teapot');

    // Return cached data if available (even if stale) when rate limited
    if (isRateLimit && cache) {
      console.warn('Rate limited, returning cached data');
      return NextResponse.json(cache.data, {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=10',
          'Content-Type': 'application/json',
          'X-Cache': 'STALE',
          'X-Rate-Limited': 'true',
        },
      });
    }

    return NextResponse.json(
      {
        error: isRateLimit ? 'Rate limit exceeded. Please try again later.' : 'Failed to fetch crypto prices',
        details: isRateLimit
          ? 'Binance API rate limit exceeded. Please wait before retrying.'
          : errorMessage,
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

