'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '../../../../../lib/supabase/client';
import { ArrowLeft } from 'lucide-react';
import { MarketOverview } from '../../../../../components/coins/MarketOverview';
import { CoinChart } from '../../../../../components/coins/CoinChart';
import { TradingButtons } from '../../../../../components/coins/TradingButtons';
import { OrderBook } from '../../../../../components/coins/OrderBook';
import { TradeHistory } from '../../../../../components/coins/TradeHistory';
import { LoadingSpinner } from '../../../../../components/shared/LoadingSpinner';

interface CoinDetail {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  market_cap: number;
  volume_24h: number;
  high_24h: number;
  low_24h: number;
  last_updated: string;
}

export default function CoinDetailPage() {
  const params = useParams();
  const router = useRouter();
  const coinId = decodeURIComponent(params.coinId as string);
  const [coinDetail, setCoinDetail] = useState<CoinDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<'orderbook' | 'trades'>('orderbook');

  useEffect(() => {
    const fetchCoinDetail = async () => {
      try {
        setLoading(true);
        setError(null);

        if (!coinId) {
          throw new Error('Coin ID is required');
        }

        // Use API route to avoid CORS issues
        const cacheKey = `/api/crypto/coin-detail?coinId=${encodeURIComponent(coinId)}`;
        const response = await fetch(cacheKey, {
          next: { revalidate: 60 }, // Cache for 1 minute
        });

        if (!response.ok) {
          // Read error data once
          let errorData: any = {};
          try {
            const text = await response.text();
            if (text) {
              errorData = JSON.parse(text);
            }
          } catch (e) {
            // If parsing fails, use empty object
          }

          // Handle rate limiting
          if (response.status === 429) {
            const retryAfter = errorData.retryAfter || 60;
            throw new Error(`Rate limit exceeded. Please wait ${retryAfter} seconds and try again.`);
          }

          // Don't show technical error details to users
          if (response.status === 404) {
            throw new Error('Coin not found');
          }

          throw new Error('Failed to load coin details. Please try again later.');
        }

        const data = await response.json();

        if (!data || !data.id) {
          throw new Error('Invalid coin data received');
        }

        // Data is already in USD format from Binance API
        const detail: CoinDetail = {
          id: data.id,
          symbol: data.symbol?.toUpperCase() || '',
          name: data.name || '',
          current_price: data.current_price || 0,
          price_change_24h: data.price_change_24h || 0,
          price_change_percentage_24h: data.price_change_percentage_24h || 0,
          market_cap: data.market_cap || 0,
          volume_24h: data.volume_24h || 0,
          high_24h: data.high_24h || 0,
          low_24h: data.low_24h || 0,
          last_updated: data.last_updated || new Date().toISOString(),
        };

        setCoinDetail(detail);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load coin details');
      } finally {
        setLoading(false);
      }
    };

    if (coinId) {
      fetchCoinDetail();
    }

    // Check and execute limit orders for this coin every 10 seconds
    const checkLimitOrders = async () => {
      try {
        await fetch('/api/orders/check-limits', { method: 'GET' });
      } catch (error) {
        console.error('Error checking limit orders:', error);
      }
    };

    // Initial check
    if (coinId) {
      checkLimitOrders();
    }

    // Set up interval to check every 10 seconds
    const interval = setInterval(() => {
      if (coinId) {
        checkLimitOrders();
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [coinId]);

  // Show skeleton/optimistic UI instead of blocking spinner
  if (loading && !coinDetail) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-4 lg:p-6">
        <button
          onClick={() => router.back()}
          className="mb-4 flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to Dashboard
        </button>
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 animate-pulse">
          <div className="h-8 bg-gray-700 rounded w-1/3 mb-4"></div>
          <div className="h-4 bg-gray-700 rounded w-1/2"></div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
          <div className="lg:col-span-2 bg-gray-800 rounded-lg border border-gray-700 p-4 h-96 animate-pulse">
            <div className="h-full bg-gray-700 rounded"></div>
          </div>
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 h-32 animate-pulse">
              <div className="h-6 bg-gray-700 rounded w-1/2 mb-2"></div>
              <div className="h-10 bg-gray-700 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !coinDetail) {
    // Check if it's a rate limit error
    const isRateLimit = error?.toLowerCase().includes('rate limit');

    return (
      <div className="min-h-screen bg-gray-900 p-6">
        <button
          onClick={() => router.back()}
          className="mb-4 flex items-center gap-2 text-blue-400 hover:text-blue-300"
        >
          <ArrowLeft className="w-5 h-5" />
          Back
        </button>
        <div className="bg-red-900/20 border border-red-700 rounded-lg p-6 text-center">
          <p className="text-red-400 text-lg font-semibold mb-2">
            {isRateLimit ? 'Rate Limit Exceeded' : 'Error Loading Coin'}
          </p>
          <p className="text-gray-400 mb-4">
            {isRateLimit
              ? 'Too many requests. Please wait a moment and try again.'
              : (error || 'Coin not found')
            }
          </p>
          {isRateLimit && (
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white"
            >
              Retry After 60 Seconds
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 lg:p-6">
      {/* Back Button */}
      <button
        onClick={() => router.back()}
        className="mb-4 flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors"
      >
        <ArrowLeft className="w-5 h-5" />
        Back to Dashboard
      </button>

      {/* Market Overview Header */}
      {coinDetail && <MarketOverview coin={coinDetail} />}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
        {/* Left Column - Chart (2/3 width on large screens) */}
        <div className="lg:col-span-2 bg-gray-800 rounded-lg border border-gray-700 p-4">
          {coinDetail && <CoinChart coinId={coinId} coinSymbol={coinDetail.symbol} />}
        </div>

        {/* Right Column - Trading Actions & Order Book (1/3 width on large screens) */}
        {coinDetail && (
          <div className="space-y-4">
            {/* Trading Buttons */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
              <h3 className="text-lg font-semibold text-white mb-4">Trading</h3>
              <TradingButtons coin={coinDetail} />
            </div>

            {/* Order Book / Trade History */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 h-[600px] flex flex-col">
              {/* Tabs */}
              <div className="flex gap-2 mb-4 border-b border-gray-700">
                <button
                  onClick={() => setSelectedTab('orderbook')}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${selectedTab === 'orderbook'
                    ? 'text-blue-400 border-b-2 border-blue-400'
                    : 'text-gray-400 hover:text-gray-300'
                    }`}
                >
                  Order Book
                </button>
                <button
                  onClick={() => setSelectedTab('trades')}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${selectedTab === 'trades'
                    ? 'text-blue-400 border-b-2 border-blue-400'
                    : 'text-gray-400 hover:text-gray-300'
                    }`}
                >
                  Trade History
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-hidden">
                {selectedTab === 'orderbook' ? (
                  <OrderBook
                    coinId={coinId}
                    coinSymbol={coinDetail.symbol}
                    currentPrice={coinDetail.current_price}
                  />
                ) : (
                  <TradeHistory coinId={coinId} coinSymbol={coinDetail.symbol} />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
