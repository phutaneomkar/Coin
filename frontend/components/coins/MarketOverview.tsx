'use client';

import { TrendingUp, TrendingDown } from 'lucide-react';

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

interface MarketOverviewProps {
  coin: CoinDetail;
}

export function MarketOverview({ coin }: MarketOverviewProps) {
  const isPositive = coin.price_change_percentage_24h >= 0;
  const ChangeIcon = isPositive ? TrendingUp : TrendingDown;

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(price);
  };

  const formatLargeNumber = (num: number) => {
    if (num >= 1000000000) {
      return `$${(num / 1000000000).toFixed(2)}B`;
    } else if (num >= 1000000) {
      return `$${(num / 1000000).toFixed(2)}M`;
    } else if (num >= 1000) {
      return `$${(num / 1000).toFixed(2)}K`;
    }
    return formatPrice(num);
  };

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        {/* Left Side - Price Info */}
        <div className="flex-1">
          <div className="flex items-center gap-4 mb-4">
            <h1 className="text-3xl font-bold text-white">
              {formatPrice(coin.current_price)}
            </h1>
            <div className={`flex items-center gap-1 ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
              <ChangeIcon className="w-5 h-5" />
              <span className="text-lg font-semibold">
                {Math.abs(coin.price_change_percentage_24h).toFixed(3)}%
              </span>
            </div>
          </div>

          {/* Market Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-400 mb-1">24h High</p>
              <p className="text-white font-semibold">{formatPrice(coin.high_24h)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-400 mb-1">24h Low</p>
              <p className="text-white font-semibold">{formatPrice(coin.low_24h)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-400 mb-1">24h Volume</p>
              <p className="text-white font-semibold">{formatLargeNumber(coin.volume_24h)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-400 mb-1">Market Cap</p>
              <p className="text-white font-semibold">{formatLargeNumber(coin.market_cap)}</p>
            </div>
          </div>
        </div>

      </div>

      {/* Trading Pair Display */}
      <div className="mt-4 pt-4 border-t border-gray-700">
        <p className="text-sm text-gray-400">
          Trading Pair: <span className="text-white font-medium">{coin.symbol} • USD</span>
        </p>
      </div>
    </div>
  );
}
