import { NextRequest, NextResponse } from 'next/server';
import { fetchCoinDCXOrderbook } from '../../../../lib/api/coindcx';
import { fetchBinanceFuturesPrice } from '../../../../lib/api/binance';

export const dynamic = 'force-dynamic';

/**
 * Lightweight real-time price - CoinDCX orderbook first, Binance Futures fallback.
 * Poll every 200ms on coin detail page for near-instant updates.
 */
export async function GET(request: NextRequest) {
  try {
    const symbol = request.nextUrl.searchParams.get('symbol');
    if (!symbol) {
      return NextResponse.json({ error: 'symbol required' }, { status: 400 });
    }

    const s = symbol.trim().toUpperCase();

    // 1. Try CoinDCX Bulk Futures Ticker (fast, includes exact LTP)
    const [futuresTickers, ob] = await Promise.all([
      import('../../../../lib/api/coindcx').then(m => m.fetchCoinDCXFuturesTickers()),
      fetchCoinDCXOrderbook(s)
    ]);

    const ticker = futuresTickers.find(t => t.symbol === `B-${s}_USDT`);
    if (ticker) {
      const price = parseFloat(ticker.last_price);
      if (price > 0) {
        return NextResponse.json(
          { price, bid: parseFloat(ticker.bid), ask: parseFloat(ticker.ask) },
          { headers: { 'Cache-Control': 'no-store, no-cache', 'Pragma': 'no-cache' } }
        );
      }
    }

    // 2. Fallback to Orderbook Mid-price
    if (ob?.bids && ob?.asks) {
      const bidPrices = Object.keys(ob.bids).map(Number).filter(Boolean).sort((a, b) => b - a);
      const askPrices = Object.keys(ob.asks).map(Number).filter(Boolean).sort((a, b) => a - b);
      const bestBid = bidPrices[0] ?? 0;
      const bestAsk = askPrices[0] ?? 0;
      const price = (bestBid && bestAsk) ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
      if (price > 0) {
        return NextResponse.json(
          { price, bid: bestBid, ask: bestAsk },
          { headers: { 'Cache-Control': 'no-store, no-cache', 'Pragma': 'no-cache' } }
        );
      }
    }

    // 3. Fallback: Binance Futures
    const binancePrice = await fetchBinanceFuturesPrice(s);
    if (binancePrice != null && binancePrice > 0) {
      return NextResponse.json(
        { price: binancePrice, bid: binancePrice, ask: binancePrice },
        { headers: { 'Cache-Control': 'no-store, no-cache', 'Pragma': 'no-cache' } }
      );
    }

    return NextResponse.json({ error: 'Orderbook not found' }, { status: 404 });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch price' }, { status: 500 });
  }
}
