'use client';

import { useState, useEffect } from 'react';
import { getBinanceSymbol } from '../../lib/api/binance';
import { formatPrice } from '../../lib/formatPrice';

interface OrderBookProps {
  coinId: string;
  coinSymbol: string;
  currentPrice: number;
}

interface Order {
  price: number;
  quantity: number;
  total: number;
}

export function OrderBook({ coinId, coinSymbol, currentPrice }: OrderBookProps) {
  const [filter, setFilter] = useState<'all' | 'bids' | 'asks'>('all');
  const [asks, setAsks] = useState<Order[]>([]);
  const [bids, setBids] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOrderBook = async () => {
      try {
        setLoading(true);
        setError(null);

        const binanceSymbol = getBinanceSymbol(coinId);
        if (!binanceSymbol) {
          throw new Error('Coin not supported on Binance');
        }

        const response = await fetch(`/api/crypto/orderbook?coinId=${encodeURIComponent(coinId)}&limit=20`);

        if (!response.ok) {
          throw new Error('Failed to fetch order book');
        }

        const data = await response.json();

        // Transform Binance order book format
        const transformedAsks: Order[] = data.asks
          .slice(0, 20) // Limit to top 20
          .map((ask: [string, string]) => {
            const price = parseFloat(ask[0]);
            const quantity = parseFloat(ask[1]);
            return {
              price,
              quantity,
              total: price * quantity,
            };
          })
          .sort((a: Order, b: Order) => a.price - b.price); // Sort asks ascending (lowest first)

        const transformedBids: Order[] = data.bids
          .slice(0, 20) // Limit to top 20
          .map((bid: [string, string]) => {
            const price = parseFloat(bid[0]);
            const quantity = parseFloat(bid[1]);
            return {
              price,
              quantity,
              total: price * quantity,
            };
          })
          .sort((a: Order, b: Order) => b.price - a.price); // Sort bids descending (highest first)

        setAsks(transformedAsks);
        setBids(transformedBids);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load order book');
      } finally {
        setLoading(false);
      }
    };

    fetchOrderBook();

    // Refresh every 3 seconds for real-time feel
    const interval = setInterval(fetchOrderBook, 3000);
    return () => clearInterval(interval);
  }, [coinId]);

  const formatQuantity = (qty: number) => {
    return qty.toFixed(4);
  };

  const formatTotal = (total: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(total);
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        Loading order book...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Filter Buttons - Segmented Control Style */}
      <div className="flex bg-gray-900 p-1 rounded-lg mb-4 border border-gray-700">
        <button
          onClick={() => setFilter('all')}
          className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${filter === 'all'
            ? 'bg-blue-600 text-white shadow-lg'
            : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
        >
          All
        </button>
        <button
          onClick={() => setFilter('bids')}
          className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${filter === 'bids'
            ? 'bg-blue-600 text-white shadow-lg'
            : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
        >
          Bids
        </button>
        <button
          onClick={() => setFilter('asks')}
          className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${filter === 'asks'
            ? 'bg-blue-600 text-white shadow-lg'
            : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
        >
          Asks
        </button>
      </div>

      {/* Order Book Table */}
      <div className="flex-1 overflow-y-auto pr-3 scrollbar-thin scrollbar-thumb-gray-700">
        {/* Header */}
        <div className="grid grid-cols-[1fr_0.8fr_1.2fr] gap-2 text-[10px] sm:text-xs text-gray-400 mb-2 pb-2 border-b border-gray-700 sticky top-0 bg-gray-800 z-10">
          <div className="text-left">Price (USD)</div>
          <div className="text-right">Qty ({coinSymbol})</div>
          <div className="text-right">Total (USD)</div>
        </div>

        {/* Asks (Sell Orders) */}
        {(filter === 'all' || filter === 'asks') && (
          <div className="mb-2">
            {asks.map((ask, index) => (
              <div
                key={`ask-${index}`}
                className="grid grid-cols-[1fr_0.8fr_1.2fr] gap-2 text-[11px] sm:text-xs py-1 hover:bg-gray-700/50 rounded cursor-pointer transition-colors relative"
              >
                {/* Visual Depth Bar (Optional - subtle background) */}
                <div
                  className="absolute right-0 top-0 bottom-0 bg-red-900/10 rounded-r"
                  style={{ width: `${Math.min(100, (ask.total / (asks[0]?.total * 5)) * 100)}%` }} // Rough relative depth
                />

                <div className="text-left text-red-400 font-mono relative z-10">{formatPrice(ask.price)}</div>
                <div className="text-right text-gray-300 font-mono relative z-10">{formatQuantity(ask.quantity)}</div>
                <div className="text-right text-gray-400 font-mono relative z-10">{formatTotal(ask.total)}</div>
              </div>
            ))}
          </div>
        )}

        {/* Current Price Indicator */}
        {filter === 'all' && (
          <div className="my-2 py-2 bg-gray-700/30 border-y border-green-700/50 sticky top-1/2 -mt-6 z-20 backdrop-blur-sm">
            <div className="flex items-center justify-center gap-2">
              <span className={`text-lg font-bold font-mono ${asks[0]?.price > bids[0]?.price ? 'text-green-400' : 'text-red-400'
                }`}>
                {formatPrice(currentPrice)}
              </span>
              <span className="text-gray-500 text-xs">USD</span>
            </div>
          </div>
        )}

        {/* Bids (Buy Orders) */}
        {(filter === 'all' || filter === 'bids') && (
          <div className="mt-2">
            {bids.map((bid, index) => (
              <div
                key={`bid-${index}`}
                className="grid grid-cols-[1fr_0.8fr_1.2fr] gap-2 text-[11px] sm:text-xs py-1 hover:bg-gray-700/50 rounded cursor-pointer transition-colors relative"
              >
                {/* Visual Depth Bar */}
                <div
                  className="absolute right-0 top-0 bottom-0 bg-green-900/10 rounded-r"
                  style={{ width: `${Math.min(100, (bid.total / (bids[0]?.total * 5)) * 100)}%` }}
                />

                <div className="text-left text-green-400 font-mono relative z-10">{formatPrice(bid.price)}</div>
                <div className="text-right text-gray-300 font-mono relative z-10">{formatQuantity(bid.quantity)}</div>
                <div className="text-right text-gray-400 font-mono relative z-10">{formatTotal(bid.total)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
