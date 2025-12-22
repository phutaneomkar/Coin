'use client';

import { useState, useEffect } from 'react';
import { getBinanceSymbol } from '../../lib/api/binance';

interface TradeHistoryProps {
  coinId: string;
  coinSymbol: string;
}

interface Trade {
  id: string;
  price: number;
  quantity: number;
  total: number;
  type: 'buy' | 'sell';
  timestamp: string;
}

export function TradeHistory({ coinId, coinSymbol }: TradeHistoryProps) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTradeHistory = async () => {
      try {
        setLoading(true);
        setError(null);

        const binanceSymbol = getBinanceSymbol(coinId);
        if (!binanceSymbol) {
          throw new Error('Coin not supported on Binance');
        }

        const response = await fetch(`/api/crypto/trades?coinId=${encodeURIComponent(coinId)}&limit=50`);

        if (!response.ok) {
          throw new Error('Failed to fetch trade history');
        }

        const data = await response.json();

        // Transform Binance trades format
        const transformedTrades: Trade[] = data.map((trade: any) => ({
          id: trade.id.toString(),
          price: parseFloat(trade.price),
          quantity: parseFloat(trade.qty),
          total: parseFloat(trade.quoteQty),
          type: trade.isBuyerMaker ? 'sell' : 'buy', // If buyer is maker, it's a sell order
          timestamp: new Date(trade.time).toISOString(),
        }));

        setTrades(transformedTrades);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load trade history');
      } finally {
        setLoading(false);
      }
    };

    fetchTradeHistory();

    // Refresh every 3 seconds for real-time feel
    const interval = setInterval(fetchTradeHistory, 3000);
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

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        Loading trade history...
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
      {/* Header */}
      <div className="grid grid-cols-4 gap-2 text-xs text-gray-400 mb-2 pb-2 border-b border-gray-700">
        <div>Time</div>
        <div className="text-right">Price (USD)</div>
        <div className="text-right">Qty ({coinSymbol})</div>
        <div className="text-right">Total (USD)</div>
      </div>

      {/* Trade List */}
      <div className="flex-1 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="text-center text-gray-400 py-8">No recent trades</div>
        ) : (
          trades.map((trade) => (
            <div
              key={trade.id}
              className="grid grid-cols-4 gap-2 text-xs py-2 border-b border-gray-700/50 hover:bg-gray-700/30 rounded"
            >
              <div className="text-gray-400">{formatTime(trade.timestamp)}</div>
              <div className={`text-right font-semibold ${trade.type === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                {formatPrice(trade.price)}
              </div>
              <div className="text-right text-gray-300">{trade.quantity.toFixed(4)}</div>
              <div className="text-right text-gray-300">
                {formatPrice(trade.total)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
