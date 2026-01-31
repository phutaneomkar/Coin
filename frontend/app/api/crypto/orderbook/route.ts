import { NextRequest, NextResponse } from 'next/server';
import { fetchCoinDCXOrderbook } from '../../../../lib/api/coindcx';
import { fetchBinanceOrderBook, getBinanceSymbol } from '../../../../lib/api/binance';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const coinId = searchParams.get('coinId');
    const limit = parseInt(searchParams.get('limit') || '20');

    if (!coinId) {
      return NextResponse.json(
        { error: 'coinId parameter is required' },
        { status: 400 }
      );
    }

    const decodedCoinId = decodeURIComponent(coinId);
    const symbol = decodedCoinId.split('-')[0].toUpperCase();

    // Prefer CoinDCX (matches coindcx.com/futures); fallback to Binance
    const coindcxOb = await fetchCoinDCXOrderbook(symbol);
    if (coindcxOb?.bids && coindcxOb?.asks) {
      const bids = Object.entries(coindcxOb.bids)
        .map(([p, q]) => [parseFloat(p), parseFloat(q)])
        .sort((a, b) => b[0] - a[0])
        .slice(0, limit);
      const asks = Object.entries(coindcxOb.asks)
        .map(([p, q]) => [parseFloat(p), parseFloat(q)])
        .sort((a, b) => a[0] - b[0])
        .slice(0, limit);
      return NextResponse.json(
        { bids, asks },
        {
          headers: {
            'Cache-Control': 'no-store, no-cache, max-age=0',
            'Content-Type': 'application/json',
          },
        }
      );
    }

    const binanceSymbol = getBinanceSymbol(decodedCoinId);
    if (!binanceSymbol) {
      return NextResponse.json(
        { error: 'Coin not found', details: `Trading pair not found for ${decodedCoinId}` },
        { status: 404 }
      );
    }

    const orderBook = await fetchBinanceOrderBook(binanceSymbol, limit);
    return NextResponse.json(orderBook, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, max-age=0',
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage.includes('Invalid symbol') || errorMessage.includes('404')) {
      return NextResponse.json(
        { error: 'Coin not found', details: 'The requested coin is not available on Binance.' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        error: 'Failed to fetch order book',
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}

