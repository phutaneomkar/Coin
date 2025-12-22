import { NextRequest, NextResponse } from 'next/server';
import { fetchBinanceKlines, getBinanceSymbol, getIntervalForTimeframe, getLimitForTimeframe } from '../../../../lib/api/binance';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const coinId = searchParams.get('coinId');
    const days = searchParams.get('days') || '7';
    const vsCurrency = searchParams.get('vs_currency') || 'usd';
    const timeframe = searchParams.get('timeframe') || '1d';

    if (!coinId) {
      return NextResponse.json(
        { error: 'coinId parameter is required' },
        { status: 400 }
      );
    }

    // Decode the coinId
    const decodedCoinId = decodeURIComponent(coinId);

    // Get Binance symbol for this coin
    const binanceSymbol = getBinanceSymbol(decodedCoinId);

    if (!binanceSymbol) {
      return NextResponse.json(
        { error: 'Coin not supported on Binance', details: `Trading pair not found for ${decodedCoinId}` },
        { status: 404 }
      );
    }

    // Map timeframe to Binance interval
    const interval = getIntervalForTimeframe(timeframe);
    const limit = getLimitForTimeframe(timeframe);

    // Fetch klines from Binance
    const klines = await fetchBinanceKlines(binanceSymbol, interval, limit);

    // Transform Binance klines to match CoinGecko format
    // CoinGecko format: [[timestamp, price], ...]
    // Binance klines: [[openTime, open, high, low, close, volume, ...], ...]
    const prices = klines.map((kline) => [
      kline[0], // Open time (timestamp in milliseconds)
      parseFloat(kline[4]), // Close price
    ]);

    const volumes = klines.map((kline) => [
      kline[0], // Open time
      parseFloat(kline[5]), // Volume
    ]);

    // Calculate OHLC for the selected timeframe from the klines
    // For the selected timeframe, we need the first candle's open, max high, min low, and last candle's close
    let ohlc = null;
    if (klines.length > 0) {
      const firstCandle = klines[0];
      const lastCandle = klines[klines.length - 1];

      const opens = klines.map(k => parseFloat(k[1]));
      const highs = klines.map(k => parseFloat(k[2]));
      const lows = klines.map(k => parseFloat(k[3]));
      const closes = klines.map(k => parseFloat(k[4]));
      const totalVolume = klines.reduce((sum, k) => sum + parseFloat(k[5]), 0);

      ohlc = {
        open: parseFloat(firstCandle[1]), // First candle's open
        high: Math.max(...highs), // Maximum high across all candles
        low: Math.min(...lows), // Minimum low across all candles
        close: parseFloat(lastCandle[4]), // Last candle's close
        volume: totalVolume, // Sum of all volumes
      };
    }

    const data = {
      prices,
      market_caps: prices, // Use prices as market caps (Binance doesn't provide market cap)
      total_volumes: volumes,
      ohlc, // Add OHLC data for the timeframe
    };

    return NextResponse.json(data, {
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
        error: 'Failed to fetch chart data',
        details: errorMessage.includes('Rate limit')
          ? 'Rate limit exceeded. Please wait a moment and try again.'
          : 'Unable to fetch chart data. Please try again later.',
      },
      { status: 500 }
    );
  }
}
