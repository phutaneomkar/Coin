import { useEffect, useRef } from 'react';
import { usePriceStore } from '../store/priceStore';
import { CryptoPrice } from '../types';

const POLL_INTERVAL_MS = 3000; // Poll CoinDCX every 3 seconds for live data

export function useCryptoPrices() {
  const { setPrices, updatePrices, setLoading, setError } = usePriceStore();
  const isMountedRef = useRef<boolean>(true);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    isMountedRef.current = true;

    const fetchPrices = async (isInitial: boolean) => {
      try {
        if (isInitial) setLoading(true);
        
        const response = await fetch('/api/crypto/prices', { cache: 'no-store' });
        
        if (!isMountedRef.current) return;
        
        if (response.ok) {
          const data = await response.json();
          if (isMountedRef.current && Array.isArray(data)) {
            if (isInitial) {
              setPrices(data);
            } else {
              updatePrices(data);
            }
            setError(null);
          }
        }
      } catch (error) {
        // Silent fail for polling updates, only log for initial
        if (isInitial) {
          console.error('Initial fetch failed:', error);
        }
      } finally {
        if (isMountedRef.current && isInitial) {
          setLoading(false);
        }
      }
    };

    // Initial fetch
    fetchPrices(true);

    // Poll for updates every 3 seconds (CoinDCX doesn't have easy public WebSocket)
    pollIntervalRef.current = setInterval(() => {
      fetchPrices(false);
    }, POLL_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [setPrices, updatePrices, setLoading, setError]);
}
