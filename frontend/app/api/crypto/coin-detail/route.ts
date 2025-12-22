import { NextRequest, NextResponse } from 'next/server';
import { fetchBinanceTicker, getBinanceSymbol } from '../../../../lib/api/binance';
import type { CoinDetail } from '../../../../types';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const coinId = searchParams.get('coinId');

    if (!coinId) {
      return NextResponse.json(
        { error: 'coinId parameter is required' },
        { status: 400 }
      );
    }

    // Decode the coinId in case it was URL encoded
    const decodedCoinId = decodeURIComponent(coinId);

    // Get Binance symbol for this coin
    const binanceSymbol = getBinanceSymbol(decodedCoinId);

    if (!binanceSymbol) {
      return NextResponse.json(
        { error: 'Coin not supported on Binance', details: `Trading pair not found for ${decodedCoinId}` },
        { status: 404 }
      );
    }

    // Fetch ticker data from Binance
    let ticker;
    try {
      ticker = await fetchBinanceTicker(binanceSymbol);
    } catch (tickerError) {
      // If symbol is invalid (400 error), return 404 instead of 500
      const errorMsg = tickerError instanceof Error ? tickerError.message : 'Unknown error';
      if (errorMsg.includes('Invalid symbol') || errorMsg.includes('400')) {
        return NextResponse.json(
          { error: 'Coin not found', details: `Trading pair ${binanceSymbol} is not available on Binance.` },
          { status: 404 }
        );
      }
      // Re-throw other errors to be handled by outer catch
      throw tickerError;
    }

    // Validate ticker data exists
    if (!ticker || !ticker.lastPrice) {
      return NextResponse.json(
        { error: 'Coin not found', details: `No data available for ${binanceSymbol} on Binance.` },
        { status: 404 }
      );
    }

    // Convert Binance ticker to our CoinDetail format
    const currentPrice = parseFloat(ticker.lastPrice) || 0;
    const priceChange24h = parseFloat(ticker.priceChange) || 0;
    const priceChangePercent24h = parseFloat(ticker.priceChangePercent) || 0;
    const high24h = parseFloat(ticker.highPrice) || 0;
    const low24h = parseFloat(ticker.lowPrice) || 0;
    const volume24h = parseFloat(ticker.quoteVolume) || 0;
    const openPrice = parseFloat(ticker.openPrice) || 0;

    const detail: CoinDetail = {
      id: decodedCoinId,
      symbol: binanceSymbol.replace('USDT', '').toUpperCase(),
      name: binanceSymbol.replace('USDT', ''), // Will be improved
      current_price: currentPrice,
      price_change_24h: priceChange24h,
      price_change_percentage_24h: priceChangePercent24h,
      market_cap: 0, // Binance doesn't provide market cap directly
      volume_24h: volume24h,
      high_24h: high24h,
      low_24h: low24h,
      last_updated: new Date(ticker.closeTime || Date.now()).toISOString(),
    };

    return NextResponse.json(detail, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120', // Cache for 1 minute
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Handle 404 from Binance
    if (errorMessage.includes('Invalid symbol') || errorMessage.includes('404')) {
      return NextResponse.json(
        { error: 'Coin not found', details: 'The requested coin is not available on Binance.' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        error: 'Failed to fetch coin details',
        details: errorMessage.includes('Rate limit')
          ? 'Rate limit exceeded. Please wait a moment and try again.'
          : 'Unable to fetch coin details. Please try again later.'
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
