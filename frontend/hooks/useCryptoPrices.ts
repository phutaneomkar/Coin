import { useEffect, useRef, useCallback } from 'react';
import { usePriceStore } from '../store/priceStore';
import { getCoinIdFromSymbol } from '../lib/api/binance';
import { CryptoPrice } from '../types';

export function useCryptoPrices() {
  const { setPrices, updatePrices, setLoading, setError, prices } = usePriceStore();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // Function to process WebSocket messages (throttled/batched if necessary, 
  // but React state updates usually batch automatically in recent versions)
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      if (!Array.isArray(data)) return;

      const newPrices: CryptoPrice[] = [];

      // Data is an array of tickers from !ticker@arr stream
      for (const ticker of data) {
        // ticker object structure from binance WS:
        // s: symbol
        // c: last price
        // p: price change
        // P: price change percent
        // v: total traded base asset volume
        // q: total traded quote asset volume

        // Filter only USDT pairs
        if (!ticker.s.endsWith('USDT')) continue;

        const currentPrice = parseFloat(ticker.c);



        const symbol = ticker.s.replace('USDT', '');
        const coinId = getCoinIdFromSymbol(ticker.s) || symbol.toLowerCase();

        const volume24h = parseFloat(ticker.q) || 0;
        // Estimate market cap like the API route does (price * base volume)
        // This is a rough proxy as circulating supply isn't in ticker
        const marketCap = currentPrice * (parseFloat(ticker.v) || 0);

        newPrices.push({
          id: coinId,
          symbol: symbol,
          name: symbol,
          current_price: currentPrice,
          price_change_24h: parseFloat(ticker.p) || 0,
          price_change_percentage_24h: parseFloat(ticker.P) || 0,
          market_cap: marketCap,
          volume_24h: volume24h,
          last_updated: new Date().toISOString(),
        });
      }

      if (newPrices.length > 0) {
        updatePrices(newPrices);
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  }, [updatePrices]);

  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      // Use Binance public stream for all tickers
      const ws = new WebSocket('wss://stream.binance.com:9443/ws/!ticker@arr');

      ws.onopen = () => {
        if (isMountedRef.current) {
          // console.log('Connected to Binance WebSocket');
          setError(null);
        }
      };

      ws.onmessage = handleMessage;

      ws.onerror = () => {
        // WebSocket errors are often empty objects for security reasons
        // Just log a warning that we'll reconnect
        console.warn('WebSocket connection issue. Attempting to reconnect...');
      };

      ws.onclose = () => {
        // console.log('WebSocket disconnected');
        wsRef.current = null;

        // Attempt reconnect if mounted
        if (isMountedRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connectWebSocket();
          }, 5000);
        }
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
    }
  }, [handleMessage, setError]);

  // Initial fetch via REST API to populate data quickly while WS connects
  useEffect(() => {
    isMountedRef.current = true;

    const fetchInitialData = async () => {
      // Only fetch if we don't have prices yet
      if (Object.keys(prices).length > 0) return;

      try {
        setLoading(true);
        const response = await fetch('/api/crypto/prices', { cache: 'no-store' });
        if (response.ok) {
          const data = await response.json();
          if (isMountedRef.current && Array.isArray(data)) {
            setPrices(data);
          }
        }
      } catch (error) {
        console.error('Initial fetch failed:', error);
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    };

    fetchInitialData();
    connectWebSocket();

    return () => {
      isMountedRef.current = false;
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connectWebSocket, prices, setLoading, setPrices]);
}
