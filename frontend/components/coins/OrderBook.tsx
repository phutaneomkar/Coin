'use client';

import { useState, useEffect } from 'react';
import { getBinanceSymbol } from '@/lib/api/binance';

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

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(price);
  };

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
      {/* Filter Buttons */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1 rounded text-sm transition-colors ${
            filter === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setFilter('bids')}
          className={`px-3 py-1 rounded text-sm transition-colors ${
            filter === 'bids'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          Bids
        </button>
        <button
          onClick={() => setFilter('asks')}
          className={`px-3 py-1 rounded text-sm transition-colors ${
            filter === 'asks'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          Asks
        </button>
      </div>

      {/* Order Book Table */}
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="grid grid-cols-3 gap-2 text-xs text-gray-400 mb-2 pb-2 border-b border-gray-700">
          <div className="text-right">Price (USD)</div>
          <div className="text-right">Qty ({coinSymbol})</div>
          <div className="text-right">Total (USD)</div>
        </div>

        {/* Asks (Sell Orders) */}
        {(filter === 'all' || filter === 'asks') && (
          <div className="mb-4">
            {asks.map((ask, index) => (
              <div
                key={`ask-${index}`}
                className="grid grid-cols-3 gap-2 text-xs py-1 hover:bg-gray-700/50 rounded cursor-pointer"
              >
                <div className="text-right text-red-400">{formatPrice(ask.price)}</div>
                <div className="text-right text-gray-300">{formatQuantity(ask.quantity)}</div>
                <div className="text-right text-gray-300">{formatTotal(ask.total)}</div>
              </div>
            ))}
          </div>
        )}

        {/* Current Price Indicator */}
        {filter === 'all' && (
          <div className="my-2 py-2 bg-green-900/20 border-y border-green-700/50">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="text-right text-green-400 font-semibold">
                {formatPrice(currentPrice)}
              </div>
              <div className="text-center text-green-400">↑</div>
              <div className="text-left text-green-400 text-xs">Current Price</div>
            </div>
          </div>
        )}

        {/* Bids (Buy Orders) */}
        {(filter === 'all' || filter === 'bids') && (
          <div>
            {bids.map((bid, index) => (
              <div
                key={`bid-${index}`}
                className="grid grid-cols-3 gap-2 text-xs py-1 hover:bg-gray-700/50 rounded cursor-pointer"
              >
                <div className="text-right text-green-400">{formatPrice(bid.price)}</div>
                <div className="text-right text-gray-300">{formatQuantity(bid.quantity)}</div>
                <div className="text-right text-gray-300">{formatTotal(bid.total)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
