import { NextRequest, NextResponse } from 'next/server';
import { fetchCoinDCXTickerBySymbol, fetchCoinDCXFuturesTicker } from '../../../../lib/api/coindcx';
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

    // Decode the coinId and extract symbol
    const decodedCoinId = decodeURIComponent(coinId);
    // coinId might be like "synapse-2" or "syn" or "SYN"
    const symbol = decodedCoinId.split('-')[0].toUpperCase();

    // Try CoinDCX futures ticker first (more accurate for futures trading)
    let futuresTicker = await fetchCoinDCXFuturesTicker(symbol);
    
    // If futures not found, try spot ticker
    let spotTicker = await fetchCoinDCXTickerBySymbol(symbol);

    if (!futuresTicker && !spotTicker) {
      return NextResponse.json(
        { error: 'Coin not found', details: `No data available for ${symbol} on CoinDCX.` },
        { status: 404 }
      );
    }

    // Use futures data if available (more accurate for your use case), fallback to spot
    let currentPrice: number;
    let high24h: number;
    let low24h: number;
    let volume24h: number;
    let priceChangePercent24h: number;

    if (futuresTicker) {
      // Futures ticker structure
      currentPrice = parseFloat(futuresTicker.mark_price || futuresTicker.last_price) || 0;
      high24h = parseFloat(futuresTicker.high) || 0;
      low24h = parseFloat(futuresTicker.low) || 0;
      volume24h = parseFloat(futuresTicker.volume) || 0;
      priceChangePercent24h = parseFloat(futuresTicker.change_24_hour) || 0;
    } else if (spotTicker) {
      // Spot ticker structure
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
