'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { formatPrice } from '../../lib/formatPrice';

type Timeframe = '1h' | '4h' | '1d' | '7d' | '1m' | '3m' | '1y';


interface CoinChartProps {
  coinId: string;
  coinSymbol: string;
}

interface CandleData {
  time: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function CoinChart({ coinId, coinSymbol }: CoinChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('4h');
  const [chartData, setChartData] = useState<CandleData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // State for the "hovered" candle to display in the header
  const [displayCandle, setDisplayCandle] = useState<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    change: number;
    changePercent: number;
  } | null>(null);

  // Keep track of the latest candle to fallback to when not hovering
  const [latestCandle, setLatestCandle] = useState<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    change: number;
    changePercent: number;
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
        next: { revalidate: 30 },
      });

      if (!response.ok) {
        let errorData: any = {};
        try {
          const text = await response.text();
          if (text) {
            errorData = JSON.parse(text);
          }
        } catch (e) { }
        throw new Error(errorData.error || errorData.details || `Failed to fetch chart data: ${response.statusText}`);
      }

      const data = await response.json();

      let formattedData: CandleData[] = [];

      if (data.candlesticks && Array.isArray(data.candlesticks)) {
        formattedData = data.candlesticks.map((c: any) => ({
          ...c,
          time: formatTime(c.timestamp, tf)
        }));
      } else if (data.prices && Array.isArray(data.prices)) {
        formattedData = data.prices.map((p: any) => ({
          timestamp: p[0],
          time: formatTime(p[0], tf),
          open: p[1],
          high: p[1],
          low: p[1],
          close: p[1],
          volume: 0
        }));
      } else {
        throw new Error('No valid chart data available');
      }

      setChartData(formattedData);

      if (formattedData.length > 0) {
        const last = formattedData[formattedData.length - 1];
        // Calculate change based on open vs close of the LAST candle, or prev close vs curr close?
        // Usually 24h change is from 24h ago. But for a specific candle, the change is usually Close - Open (intra-candle) or Close - PrevClose.
        // Let's use Intra-candle (Close - Open) for the header display context, which usually shows the active candle stats.
        const change = last.close - last.open;
        const changePercent = (change / last.open) * 100;

        const latestInfo = {
          open: last.open,
          high: last.high,
          low: last.low,
          close: last.close,
          volume: last.volume,
          change,
          changePercent
        };

        setLatestCandle(latestInfo);
        setDisplayCandle(latestInfo);
      }

      setHasLoaded(true);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load chart data';
      if (errorMessage.includes('Rate limit')) {
        setError('Rate limit exceeded. Please wait a moment and try again.');
      } else {
        setError('Unable to load chart data. Please try again later.');
      }
      setChartData([]);
      setLatestCandle(null);
      setDisplayCandle(null);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (timestamp: number, tf: Timeframe) => {
    const date = new Date(timestamp);
    switch (tf) {
      case '1h':
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      case '1d':
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      case '4h':
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit' });
      case '7d':
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      default:
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
  };

  useEffect(() => {
    if (!coinId) return;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (hasLoaded) {
      setHasLoaded(false);
      setChartData([]);
      setLatestCandle(null);
      setDisplayCandle(null);
    }
    const timer = setTimeout(() => {
      loadChartData(timeframe);
    }, 300);
    debounceTimerRef.current = timer;
    return () => { if (timer) clearTimeout(timer); };
  }, [timeframe, coinId]);

  const formatPriceDisplay = (price: number | null | undefined) => {
    if (price === undefined || price === null) return '---';
    return formatPrice(price);
  };

  const formatValue = (val: number) => {
    if (val === undefined || val === null) return '---';
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, notation: "compact" }).format(val);
  };

  // When mouse leaves chart, reset to latest candle
  const handleMouseLeave = () => {
    if (latestCandle) {
      setDisplayCandle(latestCandle);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#131722] text-[#d1d4dc] rounded-lg overflow-hidden border border-[#2a2e39]">
      {/* Pro Header - CoinDCX Style */}
      <div className="flex flex-col border-b border-[#2a2e39]">
        {/* Top Row: Coin Info + Timeframes */}
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              {coinSymbol} <span className="text-[#5d606b] text-sm font-normal">/ USD</span>
            </h2>
            <div className="hidden sm:flex items-center gap-1 bg-[#2a2e39] rounded p-0.5">
              {timeframes.map((tf) => (
                <button
                  key={tf.value}
                  onClick={() => setTimeframe(tf.value)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${timeframe === tf.value
                    ? 'bg-[#4e5c6e] text-white'
                    : 'text-[#787b86] hover:text-white hover:bg-[#2a2e39]'
                    }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>
          </div>

          {/* Additional Header Controls/Indicators could go here */}
        </div>

        {/* Second Row: Dynamic OHLC Display */}
        <div className="px-3 pb-2 flex flex-wrap gap-4 text-xs font-mono">
          {displayCandle ? (
            <>
              <div className="flex gap-1">
                <span className="text-[#787b86]">O</span>
                <span className={displayCandle.open > displayCandle.close ? 'text-[#ef5350]' : 'text-[#26a69a]'}>
                  {formatPriceDisplay(displayCandle.open)}
                </span>
              </div>
              <div className="flex gap-1">
                <span className="text-[#787b86]">H</span>
                <span className={displayCandle.open > displayCandle.close ? 'text-[#ef5350]' : 'text-[#26a69a]'}>
                  {formatPriceDisplay(displayCandle.high)}
                </span>
              </div>
              <div className="flex gap-1">
                <span className="text-[#787b86]">L</span>
                <span className={displayCandle.open > displayCandle.close ? 'text-[#ef5350]' : 'text-[#26a69a]'}>
                  {formatPriceDisplay(displayCandle.low)}
                </span>
              </div>
              <div className="flex gap-1">
                <span className="text-[#787b86]">C</span>
                <span className={displayCandle.open > displayCandle.close ? 'text-[#ef5350]' : 'text-[#26a69a]'}>
                  {formatPriceDisplay(displayCandle.close)}
                </span>
              </div>
              <div className="flex gap-1">
                <span className="text-[#787b86]">Change</span>
                <span className={displayCandle.change >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}>
                  {displayCandle.change >= 0 ? '+' : ''}{formatPriceDisplay(displayCandle.change)} ({displayCandle.changePercent.toFixed(2)}%)
                </span>
              </div>
              <div className="flex gap-1">
                <span className="text-[#787b86]">Vol</span>
                <span className="text-[#d1d4dc]">
                  {formatValue(displayCandle.volume)}
                </span>
              </div>
            </>
          ) : (
            <span className="text-[#787b86]">Loading data...</span>
          )}
        </div>
      </div>

      {/* Mobile Timeframe Selector (Only visible if screen is small) */}
      <div className="sm:hidden flex gap-2 overflow-x-auto p-2 scrollbar-hide border-b border-[#2a2e39]">
        {timeframes.map((tf) => (
          <button
            key={tf.value}
            onClick={() => setTimeframe(tf.value)}
            className={`px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap ${timeframe === tf.value
              ? 'bg-[#2962ff] text-white'
              : 'bg-[#2a2e39] text-[#787b86]'
              }`}
          >
            {tf.label}
          </button>
        ))}
      </div>

      {/* Chart Area */}
      <div className="flex-1 w-full min-h-[400px] relative bg-[#131722]" onMouseLeave={handleMouseLeave}>
        {!hasLoaded && !loading && chartData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[#787b86]">
            <p className="mb-4">Select a timeframe</p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-full text-[#787b86]">Loading chart...</div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-[#ef5350]">
            <p className="mb-2">{error}</p>
            <button
              onClick={() => loadChartData(timeframe)}
              className="px-4 py-2 bg-[#2962ff] hover:bg-blue-600 rounded text-white text-xs"
            >
              Retry
            </button>
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[#787b86]">No data available</div>
        ) : (
          <ChartVisualization
            data={chartData}
            timeframe={timeframe}
            onHover={(data) => {
              if (data) {
                const change = data.close - data.open;
                const changePercent = (change / data.open) * 100;
                setDisplayCandle({
                  ...data,
                  change,
                  changePercent
                });
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

// Custom Candle Shape
const CandleShape = (props: any) => {
  const { x, y, width, height, payload, minDomain } = props;
  const { open, close, high, low } = payload;

  if (high === undefined || low === undefined) return null;

  const range = high - minDomain;
  if (range <= 0) return null;
  const ratio = height / range;

  const yHigh = y; // Top of the bar rect (which represents High)
  const yLow = y + (high - low) * ratio;
  const yOpen = y + (high - open) * ratio;
  const yClose = y + (high - close) * ratio;

  const isUp = close >= open;
  // CoinDCX/TradingView Colors: Green #26a69a, Red #ef5350
  const color = isUp ? '#26a69a' : '#ef5350';

  const bodyTop = Math.min(yOpen, yClose);
  const bodyHeight = Math.max(1, Math.abs(yOpen - yClose));

  const stickWidth = Math.max(3, Math.min(width * 0.5, 15));
  const xOffset = (width - stickWidth) / 2;

  const wickType = isUp ? 'solid' : 'solid';

  return (
    <g stroke={color} fill={color} strokeWidth="1">
      {/* Wick */}
      <line x1={x + width / 2} y1={yHigh} x2={x + width / 2} y2={yLow} />
      {/* Body */}
      <rect
        x={x + xOffset}
        y={bodyTop}
        width={stickWidth}
        height={bodyHeight}
        stroke="none"
        fill={color}
      />
    </g>
  );
};

// Chart Visualization Component
function ChartVisualization({ data, timeframe, onHover }: { data: CandleData[], timeframe: Timeframe, onHover: (d: any) => void }) {

  const getXAxisInterval = (): number | 'preserveStartEnd' => {
    const dataLength = data.length;
    if (dataLength <= 6) return 0;
    return Math.floor(dataLength / 8);
  };

  if (data.length === 0) return null;

  // Calculate Price Axis Domain
  const allLows = data.map((d) => d.low);
  const allHighs = data.map((d) => d.high);
  const minPrice = Math.min(...allLows);
  const maxPrice = Math.max(...allHighs);
  const pricePadding = (maxPrice - minPrice) * 0.1; // 10% padding
  const yAxisMin = Math.max(0, minPrice - pricePadding);
  const yAxisMax = maxPrice + pricePadding;

  // Calculate Volume Axis Domain
  // We want volume to take up roughly bottom 15-20% of chart
  const maxVol = Math.max(...data.map(d => d.volume));
  const volYMax = maxVol * 5; // Scaling factor to push volume bars down (max bar height = 1/5th of chart)

  const formatPriceYAxis = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      notation: "compact",
      compactDisplay: "short",
      maximumFractionDigits: 2,
    }).format(value);
  };

  return (
    <div className="w-full h-full pb-4 pr-1">
      <ResponsiveContainer width="100%" height="100%" minHeight={400}>
        <ComposedChart
          data={data}
          margin={{ top: 10, right: 0, left: 10, bottom: 0 }}
          onMouseMove={(state: any) => {
            if (state && state.activePayload && state.activePayload.length) {
              onHover(state.activePayload[0].payload);
            }
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2e39" vertical={true} horizontal={true} opacity={0.5} />

          <XAxis
            dataKey="time"
            stroke="#787b86"
            style={{ fontSize: '11px', fontFamily: 'monospace' }}
            interval={getXAxisInterval()}
            tick={{ fill: '#787b86' }}
            tickLine={{ stroke: '#2a2e39' }}
            axisLine={{ stroke: '#2a2e39' }}
            minTickGap={30}
            dy={5}
          />

          {/* Price Axis - Right Side */}
          <YAxis
            yAxisId="price"
            orientation="right"
            domain={[yAxisMin, yAxisMax]}
            stroke="#787b86"
            style={{ fontSize: '11px', fontFamily: 'monospace' }}
            tickFormatter={formatPriceYAxis}
            tick={{ fill: '#787b86' }}
            tickLine={{ stroke: '#2a2e39' }}
            axisLine={{ stroke: '#2a2e39' }}
            width={60}
          />

          {/* Volume Axis - Hidden or separate? Hidden but used for scaling */}
          <YAxis
            yAxisId="volume"
            orientation="left"
            domain={[0, volYMax]}
            hide={true}
          />

          <Tooltip
            content={() => null} // Hide default tooltip, we use header
            cursor={{ stroke: '#787b86', strokeWidth: 1, strokeDasharray: '4 4' }}
            isAnimationActive={false}
          />

          {/* Volume Bars */}
          <Bar
            yAxisId="volume"
            dataKey="volume"
            fillOpacity={0.5}
          >
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.close >= entry.open ? '#26a69a' : '#ef5350'}
              />
            ))}
          </Bar>

          {/* Candlesticks */}
          <Bar
            yAxisId="price"
            dataKey="high"
            shape={(props: any) => <CandleShape {...props} minDomain={yAxisMin} />}
            isAnimationActive={false}
          />

          {/* Current Price Line */}
          <ReferenceLine
            yAxisId="price"
            y={data[data.length - 1]?.close}
            stroke={data[data.length - 1]?.close >= data[data.length - 1]?.open ? '#26a69a' : '#ef5350'}
            strokeDasharray="3 3"
            label={{
              position: 'right',
              value: formatPriceYAxis(data[data.length - 1]?.close),
              fill: '#fff',
              fontSize: 10,
              fillOpacity: 1,
              fontWeight: 'bold',
              className: 'bg-red-500' // This requires customize formatting, Recharts label is simple SVG text
            }}
          />

        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
