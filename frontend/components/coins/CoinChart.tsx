'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';

type Timeframe = '1h' | '4h' | '1d' | '7d' | '1m' | '3m' | '1y';

interface CoinChartProps {
  coinId: string;
  coinSymbol: string;
}

export function CoinChart({ coinId, coinSymbol }: CoinChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('4h');
  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [currentCandle, setCurrentCandle] = useState<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  } | null>(null);

  const timeframes: { label: string; value: Timeframe }[] = [
    { label: '1h', value: '1h' },
    { label: '4h', value: '4h' },
    { label: '1d', value: '1d' },
    { label: '7d', value: '7d' },
    { label: '1m', value: '1m' },
    { label: '3m', value: '3m' },
    { label: '1y', value: '1y' },
  ];

  const loadChartData = async (tf: Timeframe) => {
    if (!coinId) return;

    try {
      setLoading(true);
      setError(null);

      // Map timeframe to days for CoinGecko API
      const daysMap: Record<Timeframe, number> = {
        '1h': 1,
        '4h': 1,
        '1d': 7,
        '7d': 30,
        '1m': 30,
        '3m': 90,
        '1y': 365,
      };

      const days = daysMap[tf];
      const cacheKey = `/api/crypto/chart?coinId=${coinId}&days=${days}&vs_currency=usd&timeframe=${tf}`;
      const response = await fetch(cacheKey, {
        next: { revalidate: 30 }, // Cache for 30 seconds
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
        throw new Error(errorData.error || errorData.details || `Failed to fetch chart data: ${response.statusText}`);
      }

      const data = await response.json();

      // Validate data structure
      if (!data || !data.prices || !Array.isArray(data.prices)) {
        throw new Error('Invalid chart data format received');
      }

      if (data.prices.length === 0) {
        throw new Error('No price data available for this timeframe');
      }

      setChartData(data.prices);
      setHasLoaded(true);

      // Use OHLC data from API if available (more accurate for timeframe)
      if (data.ohlc) {
        setCurrentCandle({
          open: data.ohlc.open || 0,
          high: data.ohlc.high || 0,
          low: data.ohlc.low || 0,
          close: data.ohlc.close || 0,
          volume: data.ohlc.volume || 0,
        });
      } else {
        // Fallback: calculate from prices if OHLC not available
        const prices = data.prices.map((p: [number, number]) => p[1]).filter((p: number) => p > 0);
        const volumes = data.total_volumes?.map((v: [number, number]) => v[1]).filter((v: number) => v > 0) || [];

        if (prices.length > 0) {
          const lastPrice = data.prices[data.prices.length - 1];

          setCurrentCandle({
            open: prices[0] || 0,
            high: Math.max(...prices) || 0,
            low: Math.min(...prices) || 0,
            close: lastPrice[1] || 0,
            volume: volumes.length > 0 ? volumes.reduce((sum: number, v: number) => sum + v, 0) : 0,
          });
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load chart data';
      if (errorMessage.includes('Rate limit')) {
        setError('Rate limit exceeded. Please wait a moment and try again.');
      } else {
        setError('Unable to load chart data. Please try again later.');
      }
      setChartData([]);
      setCurrentCandle(null);
    } finally {
      setLoading(false);
    }
  };

  // Handle timeframe changes with debounce
  useEffect(() => {
    if (!coinId) return;

    // Clear any existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Reset state when timeframe changes
    if (hasLoaded) {
      setHasLoaded(false);
      setChartData([]);
      setCurrentCandle(null);
    }

    // Debounce chart data fetching to prevent rapid API calls
    const timer = setTimeout(() => {
      loadChartData(timeframe);
    }, 300); // 300ms debounce - fast enough for good UX, prevents rapid calls

    debounceTimerRef.current = timer;

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [timeframe, coinId]);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(price);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Chart Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          {coinSymbol} <span className="text-gray-500">•</span> USD
        </h2>

        {/* Scrollable Timeframes on Mobile */}
        <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0 scrollbar-hide w-full sm:w-auto">
          {timeframes.map((tf) => (
            <button
              key={tf.value}
              onClick={() => setTimeframe(tf.value)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${timeframe === tf.value
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700'
                }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {/* Current Candle Info - Responsive Grid */}
      {currentCandle && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-4 p-4 bg-gray-800/50 border border-gray-700 rounded-lg text-sm shadow-inner">
          <div className="flex flex-col">
            <span className="text-xs text-gray-500">Open</span>
            <span className="text-white font-mono">{formatPrice(currentCandle.open)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-gray-500">High</span>
            <span className="text-green-400 font-mono">{formatPrice(currentCandle.high)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-gray-500">Low</span>
            <span className="text-red-400 font-mono">{formatPrice(currentCandle.low)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-gray-500">Close</span>
            <span className="text-white font-mono">{formatPrice(currentCandle.close)}</span>
          </div>
          <div className="flex flex-col col-span-2 sm:col-span-1 border-t sm:border-t-0 border-gray-700 pt-2 sm:pt-0 mt-2 sm:mt-0">
            <span className="text-xs text-gray-500">Volume</span>
            <span className="text-white font-mono">
              {new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, notation: "compact" }).format(currentCandle.volume)}
            </span>
          </div>
        </div>
      )}

      {/* Chart Area */}
      <div className="flex-1 bg-gray-900 rounded border border-gray-700 p-4 min-h-[400px]">
        {!hasLoaded && !loading && chartData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <p className="mb-4">Click a timeframe to load chart data</p>
            <button
              onClick={() => loadChartData(timeframe)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white text-sm"
            >
              Load Chart
            </button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-full text-gray-400">Loading chart data...</div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-red-400">
            <p className="mb-2">{error}</p>
            <button
              onClick={() => loadChartData(timeframe)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white text-sm"
            >
              Retry
            </button>
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400">No chart data available</div>
        ) : (
          <ChartVisualization data={chartData} timeframe={timeframe} />
        )}
      </div>
    </div>
  );
}

// Chart Visualization Component
function ChartVisualization({ data, timeframe }: { data: [number, number][], timeframe: Timeframe }) {
  // Transform data for recharts
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    // Format time based on timeframe for better readability - shorter format to prevent overlap
    const formatTime = (timestamp: number) => {
      const date = new Date(timestamp);
      switch (timeframe) {
        case '1h':
          // For 1h: show hour:minute only (e.g., "05:30")
          return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        case '1d':
          // For 1d: show month day, hour (e.g., "Mar 7, 05:30")
          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        case '4h':
          // For 4h: show month day, hour (e.g., "Mar 7, 05")
          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit' });
        case '7d':
          // For 7d: show month day (e.g., "Mar 7")
          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        case '1m':
        case '3m':
          // For months: show month day (e.g., "Mar 7")
          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        case '1y':
          // For 1y: show month year (e.g., "Mar 2024")
          return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        default:
          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      }
    };

    return data
      .filter(([timestamp, price]) => timestamp && price && price > 0) // Filter invalid data
      .map(([timestamp, price]) => ({
        time: formatTime(timestamp),
        timestamp,
        price: price,
        value: price,
      }));
  }, [data, timeframe]);

  // Calculate X-axis interval based on timeframe
  // Limit to max 6-8 labels to prevent overcrowding
  const getXAxisInterval = (): number | 'preserveStartEnd' => {
    const dataLength = chartData.length;
    if (dataLength === 0) return 'preserveStartEnd';

    // Target: Show approximately 5-8 labels maximum for readability
    const maxLabels = 7;
    const minInterval = Math.max(1, Math.floor(dataLength / maxLabels));

    // For very short timeframes with few data points, show all
    if (dataLength <= maxLabels) {
      return 0; // Show all labels
    }

    // For longer timeframes, calculate interval to show ~maxLabels
    switch (timeframe) {
      case '1h':
        // 24 data points: show ~6 labels (every 4th point)
        return Math.max(1, Math.floor(dataLength / 6));
      case '4h':
        // 42 data points: show ~6 labels (every 7th point)
        return Math.max(1, Math.floor(dataLength / 6));
      case '1d':
        // 24 data points: show ~6 labels (every 4th point)
        return Math.max(1, Math.floor(dataLength / 6));
      case '7d':
        // 7 data points: show all
        return 0;
      case '1m':
        // 30 data points: show ~6 labels (every 5th point)
        return Math.max(1, Math.floor(dataLength / 6));
      case '3m':
        // 90 data points: show ~7 labels (every 13th point)
        return Math.max(1, Math.floor(dataLength / 7));
      case '1y':
        // 365 data points: show ~7 labels (every 52nd point)
        return Math.max(1, Math.floor(dataLength / 7));
      default:
        // Default: show ~6 labels
        return Math.max(1, Math.floor(dataLength / 6));
    }
  };

  // Calculate price range for Y-axis
  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        No valid chart data available
      </div>
    );
  }

  const prices = chartData.map((d) => d.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice;
  const yAxisMin = Math.max(0, minPrice - priceRange * 0.1);
  const yAxisMax = maxPrice + priceRange * 0.1;

  // Determine if price is going up or down
  const isPositive = chartData.length > 1
    ? chartData[chartData.length - 1].price >= chartData[0].price
    : true;

  const formatPrice = (value: number) => {
    if (!value || isNaN(value)) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(value);
  };

  return (
    <div className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%" minHeight={400}>
        <AreaChart
          data={chartData}
          margin={{ top: 10, right: 10, left: 10, bottom: 10 }}
        >
          <defs>
            <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor={isPositive ? '#10b981' : '#ef4444'}
                stopOpacity={0.3}
              />
              <stop
                offset="95%"
                stopColor={isPositive ? '#10b981' : '#ef4444'}
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="time"
            stroke="#9ca3af"
            style={{ fontSize: '12px' }}
            interval={getXAxisInterval()}
            angle={-45}
            textAnchor="end"
            height={80}
            tick={{ fill: '#9ca3af', fontSize: 11 }}
            tickMargin={8}
          />
          <YAxis
            domain={[yAxisMin, yAxisMax]}
            stroke="#9ca3af"
            style={{ fontSize: '12px' }}
            tickFormatter={formatPrice}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1f2937',
              border: '1px solid #374151',
              borderRadius: '8px',
              color: '#f3f4f6',
            }}
            formatter={(value: any) => [formatPrice(Number(value) || 0), 'Price']}
            labelStyle={{ color: '#9ca3af' }}
          />
          <Area
            type="monotone"
            dataKey="price"
            stroke={isPositive ? '#10b981' : '#ef4444'}
            strokeWidth={2}
            fill="url(#colorPrice)"
            dot={false}
            activeDot={{ r: 4, fill: isPositive ? '#10b981' : '#ef4444' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
