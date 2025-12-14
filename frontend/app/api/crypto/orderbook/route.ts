import { NextRequest, NextResponse } from 'next/server';
import { fetchBinanceOrderBook, getBinanceSymbol } from '@/lib/api/binance';

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

    // Fetch order book from Binance
    const orderBook = await fetchBinanceOrderBook(binanceSymbol, limit);

    return NextResponse.json(orderBook, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=6', // Cache for 3 seconds
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

