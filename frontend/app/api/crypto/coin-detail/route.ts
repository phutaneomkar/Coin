import { NextRequest, NextResponse } from 'next/server';
import { fetchCoinDCXTickerBySymbol, fetchCoinDCXFuturesData, fetchCoinDCXFuturesTickers, CoinDCXFuturesTicker } from '../../../../lib/api/coindcx';
import { fetchBinanceFuturesTicker24h } from '../../../../lib/api/binance';
import type { CoinDetail } from '../../../../types';

export const dynamic = 'force-dynamic';

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

    const decodedCoinId = decodeURIComponent(coinId);
    const symbol = decodedCoinId.split('-')[0].toUpperCase();

    // Use bulk futures tickers for real-time LTP
    const [futuresTickers, spotTicker, binanceFutures] = await Promise.all([
      fetchCoinDCXFuturesTickers(),
      fetchCoinDCXTickerBySymbol(symbol),
      fetchBinanceFuturesTicker24h(symbol),
    ]);

    const ticker = futuresTickers.find((t: CoinDCXFuturesTicker) => t.symbol === `B-${symbol}_USDT`);

    let currentPrice: number;
    let high24h: number;
    let low24h: number;
    let volume24h: number;
    let priceChangePercent24h: number;

    if (ticker && parseFloat(ticker.last_price) > 0) {
      currentPrice = parseFloat(ticker.last_price);
      high24h = parseFloat(ticker.high_24h) || currentPrice;
      low24h = parseFloat(ticker.low_24h) || currentPrice;
      volume24h = parseFloat(ticker.volume_24h) || 0;
      // B-SYMBOL_USDT uses Binance - Binance Futures 24h % matches CoinDCX futures
      priceChangePercent24h = binanceFutures?.priceChangePercent ?? parseFloat(ticker.change_24h) ?? (spotTicker ? parseFloat(spotTicker.change_24_hour) || 0 : 0);
    } else if (spotTicker) {
      currentPrice = parseFloat(spotTicker.last_price) || 0;
      high24h = parseFloat(spotTicker.high) || 0;
      low24h = parseFloat(spotTicker.low) || 0;
      volume24h = parseFloat(spotTicker.volume) || 0;
      priceChangePercent24h = parseFloat(spotTicker.change_24_hour) || 0;
    } else {
      return NextResponse.json(
        { error: 'Coin not found', details: `No data available for ${symbol} on CoinDCX.` },
        { status: 404 }
      );
    }

    const priceChange24h = currentPrice * (priceChangePercent24h / 100);

    const detail: CoinDetail = {
      id: decodedCoinId,
      symbol: symbol,
      name: symbol,
      current_price: currentPrice,
      price_change_24h: priceChange24h,
      price_change_percentage_24h: priceChangePercent24h,
      market_cap: 0,
      volume_24h: volume24h,
      high_24h: high24h,
      low_24h: low24h,
      last_updated: new Date().toISOString(),
    };


    return NextResponse.json(detail, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

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
