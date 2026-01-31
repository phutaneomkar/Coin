/**
 * Binance API Integration
 * Using Binance Testnet for sandbox trading environment
 * Testnet URL: https://testnet.binance.vision/api
 * 
 * Benefits:
 * - Much higher rate limits (1200 requests/minute)
 * - Real market data
 * - Trading functionality (buy/sell)
 * - Free to use
 * - Virtual funds for testing
 */

const BINANCE_TESTNET_URL = 'https://testnet.binance.vision/api';
const BINANCE_MAINNET_URL = 'https://api.binance.com/api';
// Use mainnet by default for market data (testnet only has ~20 pairs)
// Set NEXT_PUBLIC_BINANCE_USE_TESTNET=true to use testnet (for trading/testing)
const USE_TESTNET = process.env.NEXT_PUBLIC_BINANCE_USE_TESTNET === 'true';

const BINANCE_API_BASE = USE_TESTNET ? BINANCE_TESTNET_URL : BINANCE_MAINNET_URL;

export interface BinanceTicker {
  symbol: string;
  price: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  prevClosePrice: string;
  lastPrice: string;
  lastQty: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  firstId: number;
  lastId: number;
  count: number;
}

export interface BinanceSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  baseAssetPrecision: number;
  quoteAsset: string;
  quotePrecision: number;
  quoteAssetPrecision: number;
  orderTypes: string[];
  isSpotTradingAllowed: boolean;
}

export interface BinanceKline {
  0: number; // Open time
  1: string; // Open
  2: string; // High
  3: string; // Low
  4: string; // Close
  5: string; // Volume
  6: number; // Close time
  7: string; // Quote asset volume
  8: number; // Number of trades
  9: string; // Taker buy base asset volume
  10: string; // Taker buy quote asset volume
  11: string; // Ignore
}

export interface BinanceOrder {
  symbol: string;
  orderId: number;
  orderListId: number;
  clientOrderId: string;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: string;
  timeInForce: string;
  type: string;
  side: string;
  stopPrice: string;
  icebergQty: string;
  time: number;
  updateTime: number;
  isWorking: boolean;
  origQuoteOrderQty: string;
}

/**
 * Map CoinGecko coin IDs to Binance trading pairs
 * Most coins trade against USDT on Binance
 */
const COIN_TO_BINANCE_SYMBOL: Record<string, string> = {
  'bitcoin': 'BTCUSDT',
  'ethereum': 'ETHUSDT',
  'binancecoin': 'BNBUSDT',
  'solana': 'SOLUSDT',
  'cardano': 'ADAUSDT',
  'ripple': 'XRPUSDT',
  'polkadot': 'DOTUSDT',
  'dogecoin': 'DOGEUSDT',
  'avalanche-2': 'AVAXUSDT',
  'polygon': 'MATICUSDT',
  'chainlink': 'LINKUSDT',
  'litecoin': 'LTCUSDT',
  'uniswap': 'UNIUSDT',
  'bitcoin-cash': 'BCHUSDT',
  'stellar': 'XLMUSDT',
  'tether': 'USDTUSDT',
  'usd-coin': 'USDCUSDT',
  'shiba-inu': 'SHIBUSDT',
  'matic-network': 'MATICUSDT',
  'cosmos': 'ATOMUSDT',
  'algorand': 'ALGOUSDT',
  'filecoin': 'FILUSDT',
  'tron': 'TRXUSDT',
  'ethereum-classic': 'ETCUSDT',
  'vechain': 'VETUSDT',
  'theta-token': 'THETAUSDT',
  'aave': 'AAVEUSDT',
  'compound-governance-token': 'COMPUSDT',
  'maker': 'MKRUSDT',
  'dai': 'DAIUSDT',
  'wrapped-bitcoin': 'WBTCUSDT',
  'eos': 'EOSUSDT',
  'tezos': 'XTZUSDT',
  'monero': 'XMRUSDT',
  'dash': 'DASHUSDT',
  'zcash': 'ZECUSDT',
  'decentraland': 'MANAUSDT',
  'the-sandbox': 'SANDUSDT',
  'axie-infinity': 'AXSUSDT',
  'enjincoin': 'ENJUSDT',
  'gala': 'GALAUSDT',
  'mana': 'MANAUSDT',
  'flow': 'FLOWUSDT',
  'near': 'NEARUSDT',
  'aptos': 'APTUSDT',
  'optimism': 'OPUSDT',
  'arbitrum': 'ARBUSDT',
  'immutable-x': 'IMXUSDT',
  'loopring': 'LRCUSDT',
  'zilliqa': 'ZILUSDT',
  'bittorrent': 'BTTUSDT',
};

/**
 * Reverse map: Binance symbol to CoinGecko ID
 */
const BINANCE_SYMBOL_TO_COIN: Record<string, string> = Object.fromEntries(
  Object.entries(COIN_TO_BINANCE_SYMBOL).map(([coin, symbol]) => [symbol, coin])
);

/**
 * Get Binance symbol from coin ID
 * If not in mapping, generate symbol dynamically (e.g., "kda" -> "KDAUSDT")
 */
export function getBinanceSymbol(coinId: string): string | null {
  const lowerCoinId = coinId.trim().toLowerCase();

  // First check the mapping
  const mapped = COIN_TO_BINANCE_SYMBOL[lowerCoinId];
  if (mapped) {
    return mapped;
  }

  // If not in mapping, generate symbol dynamically
  // Remove hyphens and convert to uppercase, then append USDT
  const symbol = lowerCoinId.replace(/-/g, '').toUpperCase() + 'USDT';
  return symbol;
}

/**
 * Get coin ID from Binance symbol
 * If not in mapping, generate coin ID from symbol (lowercase, remove USDT)
 */
export function getCoinIdFromSymbol(symbol: string): string | null {
  const mapped = BINANCE_SYMBOL_TO_COIN[symbol];
  if (mapped) {
    return mapped;
  }
  // If not in mapping, generate coin ID from symbol (e.g., "LRCUSDT" -> "lrc")
  if (symbol.endsWith('USDT')) {
    return symbol.replace('USDT', '').toLowerCase();
  }
  return null;
}

/**
 * Fetch 24hr ticker statistics for all symbols
 * Includes retry logic with exponential backoff for rate limiting
 */
export async function fetchBinanceTickers(maxRetries: number = 3): Promise<BinanceTicker[]> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(`${BINANCE_API_BASE}/v3/ticker/24hr`, {
        cache: 'no-store', // Response is too large for Next.js cache (>2MB)
      });

      // Handle rate limiting (429) or server errors (5xx)
      if (response.status === 429 || response.status === 418) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '0') || Math.pow(2, attempt);
        const waitTime = retryAfter * 1000; // Convert to milliseconds

        if (attempt < maxRetries - 1) {
          // Wait before retrying with exponential backoff
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        throw new Error(`Rate limit exceeded. Please try again later.`);
      }

      if (!response.ok) {
        // For other errors, throw immediately
        throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');

      // If it's a rate limit error and we have retries left, continue
      if (lastError.message.includes('Rate limit') && attempt < maxRetries - 1) {
        const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      // For non-rate-limit errors or final attempt, throw
      if (attempt === maxRetries - 1) {
        throw lastError;
      }
    }
  }

  throw lastError || new Error('Failed to fetch Binance tickers');
}

const BINANCE_FUTURES_URL = 'https://fapi.binance.com';

/** Binance Futures 24h ticker item */
export interface BinanceFuturesTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
}

/**
 * Fetch ALL Binance Futures 24h tickers - one call, matches CoinDCX futures (B-SYMBOL_USDT)
 */
export async function fetchBinanceFuturesAllTickers(): Promise<BinanceFuturesTicker[]> {
  try {
    const res = await fetch(`${BINANCE_FUTURES_URL}/fapi/v1/ticker/24hr`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/**
 * Fetch Binance Futures last price - fast fallback when CoinDCX orderbook unavailable
 * B-SYMBOL_USDT on CoinDCX = Binance Futures
 */
export async function fetchBinanceFuturesPrice(symbol: string): Promise<number | null> {
  const futuresSymbol = `${symbol.toUpperCase()}USDT`;
  try {
    const res = await fetch(`${BINANCE_FUTURES_URL}/fapi/v1/ticker/price?symbol=${futuresSymbol}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const price = parseFloat(data?.price);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/**
 * Fetch Binance Futures 24h ticker - matches CoinDCX futures (B-SYMBOL_USDT uses Binance)
 * Returns priceChangePercent or null if not available
 */
export async function fetchBinanceFuturesTicker24h(symbol: string): Promise<{ priceChangePercent: number } | null> {
  const futuresSymbol = `${symbol.toUpperCase()}USDT`;
  try {
    const res = await fetch(`${BINANCE_FUTURES_URL}/fapi/v1/ticker/24hr?symbol=${futuresSymbol}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const pct = parseFloat(data?.priceChangePercent);
    return Number.isFinite(pct) ? { priceChangePercent: pct } : null;
  } catch {
    return null;
  }
}

/**
 * Fetch exchange information (all trading pairs)
 */
export async function fetchBinanceExchangeInfo(): Promise<{
  symbols: BinanceSymbol[];
  timezone: string;
  serverTime: number;
}> {
  const response = await fetch(`${BINANCE_API_BASE}/v3/exchangeInfo`, {
    next: { revalidate: 3600 }, // Cache for 1 hour
  });

  if (!response.ok) {
    throw new Error(`Binance API error: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch 24hr ticker for a specific symbol
 */
export async function fetchBinanceTicker(symbol: string): Promise<BinanceTicker> {
  const response = await fetch(`${BINANCE_API_BASE}/v3/ticker/24hr?symbol=${symbol}`, {
    next: { revalidate: 1 }, // Cache for 1 second (real-time)
  });

  if (!response.ok) {
    if (response.status === 400) {
      throw new Error(`Invalid symbol: ${symbol}`);
    }
    throw new Error(`Binance API error: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch 3h price change % for a symbol (last 3 hours).
 * Uses klines: previous candle close = price 3h ago, current price passed in.
 */
export async function fetch3hChangePercent(
  symbol: string,
  currentPrice: number
): Promise<number | null> {
  try {
    const klines = await fetchBinanceKlines(symbol, '3h', 2);
    if (!klines || klines.length < 1) return null;
    const close3hAgo = parseFloat(klines[0][4]);
    if (!close3hAgo || close3hAgo <= 0) return null;
    return ((currentPrice - close3hAgo) / close3hAgo) * 100;
  } catch {
    return null;
  }
}

/**
 * Fetch klines (candlestick data) for chart
 */
export async function fetchBinanceKlines(
  symbol: string,
  interval: string = '1h',
  limit: number = 500,
  startTime?: number,
  endTime?: number
): Promise<BinanceKline[]> {
  let url = `${BINANCE_API_BASE}/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

  if (startTime) {
    url += `&startTime=${startTime}`;
  }
  if (endTime) {
    url += `&endTime=${endTime}`;
  }

  const response = await fetch(url, {
    next: { revalidate: 5 }, // Cache for 5 seconds
  });

  if (!response.ok) {
    throw new Error(`Binance API error: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Map Binance interval to days for timeframe selection
 * Uses appropriate intervals for accurate OHLC data
 */
export function getIntervalForTimeframe(timeframe: string): string {
  const map: Record<string, string> = {
    '1h': '1h', // 1 hour intervals for 1h view
    '4h': '4h', // 4 hour intervals for 4h view
    '1d': '1h', // 1 hour intervals for 1 day view (to show intraday movement)
    '7d': '1d', // Daily intervals for 7 days view
    '1m': '1d', // Daily intervals for 1 month view
    '3m': '1d', // Daily intervals for 3 months view
    '1y': '1d', // Daily intervals for 1 year view
  };
  return map[timeframe] || '1h';
}

/**
 * Get limit for timeframe (how many candles to fetch)
 * Updated to fetch appropriate data for each timeframe
 */
export function getLimitForTimeframe(timeframe: string): number {
  const map: Record<string, number> = {
    '1h': 24, // 24 hours of 1h candles (24 candles)
    '4h': 42, // 7 days * 24 hours / 4 = 42 candles (7 days of 4h candles)
    '1d': 24, // 24 hours of 1h candles (24 candles for 1 day view)
    '7d': 7, // 7 days of daily candles (7 candles)
    '1m': 30, // 30 days of daily candles (30 candles for 1 month)
    '3m': 90, // 90 days of daily candles (90 candles for 3 months)
    '1y': 365, // 365 days of daily candles (365 candles for 1 year)
  };
  return map[timeframe] || 24;
}

export interface BinanceOrderBookEntry {
  price: string;
  qty: string;
}

export interface BinanceOrderBook {
  lastUpdateId: number;
  bids: BinanceOrderBookEntry[];
  asks: BinanceOrderBookEntry[];
}

/**
 * Fetch order book depth from Binance
 */
export async function fetchBinanceOrderBook(
  symbol: string,
  limit: number = 20
): Promise<BinanceOrderBook> {
  const response = await fetch(`${BINANCE_API_BASE}/v3/depth?symbol=${symbol}&limit=${limit}`, {
    next: { revalidate: 1 }, // Cache for 1 second (order book changes frequently)
  });

  if (!response.ok) {
    throw new Error(`Binance API error: ${response.statusText}`);
  }

  return response.json();
}

export interface BinanceRecentTrade {
  id: number;
  price: string;
  qty: string;
  quoteQty: string;
  time: number;
  isBuyerMaker: boolean;
  isBestMatch: boolean;
}

/**
 * Fetch recent trades from Binance
 */
export async function fetchBinanceRecentTrades(
  symbol: string,
  limit: number = 50
): Promise<BinanceRecentTrade[]> {
  const response = await fetch(`${BINANCE_API_BASE}/v3/trades?symbol=${symbol}&limit=${limit}`, {
    next: { revalidate: 1 },
  });

  if (!response.ok) {
    throw new Error(`Binance API error: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch Futures exchange info to identify coins listed on Futures
 */
export async function fetchBinanceFuturesExchangeInfo(): Promise<{
  symbols: Array<{ symbol: string; status: string; }>;
}> {
  // Binance Futures API
  const response = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo', {
    next: { revalidate: 3600 }, // Cache for 1 hour
  });

  if (!response.ok) {
    throw new Error(`Binance Futures API error: ${response.statusText}`);
  }

  return response.json();
}

