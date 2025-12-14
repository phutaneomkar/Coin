import { NextResponse } from 'next/server';
import { fetchBinanceTickers, fetchBinanceExchangeInfo, getCoinIdFromSymbol } from '@/lib/api/binance';
import { CryptoPrice } from '@/types';

// Use mainnet for market data to get all available coins
// Testnet only has ~20 trading pairs, mainnet has thousands
const BINANCE_API_BASE = process.env.NEXT_PUBLIC_BINANCE_USE_TESTNET === 'true'
  ? 'https://testnet.binance.vision/api'
  : 'https://api.binance.com/api';

export async function GET() {
  try {
    // Fetch all 24hr tickers from Binance
    const tickers = await fetchBinanceTickers();
    
    // Filter only USDT pairs and convert to our format
    // Include ALL USDT pairs, not just mapped ones
    const prices: CryptoPrice[] = tickers
      .filter((ticker) => ticker.symbol.endsWith('USDT'))
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
        };
      })
      .filter((price) => price.current_price > 0) // Only include coins with valid prices
      .sort((a, b) => b.market_cap - a.market_cap); // Sort by market cap

    if (prices.length === 0) {
      throw new Error('No prices fetched from Binance');
    }

    return NextResponse.json(prices, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120', // Cache for 1 minute
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { 
        error: 'Failed to fetch crypto prices',
        details: errorMessage.includes('Binance') 
          ? errorMessage
          : 'Unable to fetch prices. Please try again later.'
      },
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
}
