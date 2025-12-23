import { useEffect, useRef } from 'react';
import { usePriceStore } from '../store/priceStore';

export function useCryptoPrices() {
  const { setPrices, setLoading, setError } = usePriceStore();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollIntervalRef = useRef<number>(30000); // Start with 30 seconds
  const consecutiveErrorsRef = useRef<number>(0);

  useEffect(() => {
    let isMounted = true;

    const loadPrices = async () => {
      if (!isMounted) return;

      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/crypto/prices', {
          next: { revalidate: 5 }, // Use Next.js revalidation instead of no-store
          headers: {
            'Content-Type': 'application/json',
          }
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const isRateLimit = response.status === 429 || errorData.error?.includes('Rate limit');
          
          // If rate limited, increase polling interval exponentially
          if (isRateLimit) {
            consecutiveErrorsRef.current += 1;
            // Increase interval: 30s -> 60s -> 120s -> 300s (max 5 minutes)
            pollIntervalRef.current = Math.min(
              300000,
              Math.pow(2, consecutiveErrorsRef.current) * 30000
            );
            
            // Restart interval with new timing
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
            }
            intervalRef.current = setInterval(loadPrices, pollIntervalRef.current);
            
            // Return cached data if available (from stale-while-revalidate)
            if (response.headers.get('X-Cache') === 'STALE') {
              try {
                const cachedData = await response.json();
                if (isMounted && cachedData) {
                  setPrices(cachedData);
                  setError(null);
                }
                return;
              } catch (e) {
                // Fall through to error handling
              }
            }
            
            const retryAfter = errorData.retryAfter || Math.ceil(pollIntervalRef.current / 1000);
            throw new Error(`Rate limit exceeded. Retrying in ${retryAfter} seconds...`);
          }
          
          throw new Error(errorData.error || errorData.details || 'Failed to fetch prices');
        }

        const prices = await response.json();
        if (isMounted) {
          setPrices(prices);
          // Reset error counter on successful fetch
          consecutiveErrorsRef.current = 0;
          
          // Reset polling interval if it was increased due to errors
          if (pollIntervalRef.current > 30000) {
            pollIntervalRef.current = 30000;
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
            }
            intervalRef.current = setInterval(loadPrices, pollIntervalRef.current);
          }
        }
      } catch (error) {
        if (isMounted) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to fetch prices';
          setError(errorMessage);
          console.error('Error fetching crypto prices:', error);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    // Load prices immediately
    loadPrices();

    // Set up interval to refresh prices (starts at 30 seconds, adjusts based on rate limits)
    intervalRef.current = setInterval(loadPrices, pollIntervalRef.current);

    return () => {
      isMounted = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [setPrices, setLoading, setError]);
}
