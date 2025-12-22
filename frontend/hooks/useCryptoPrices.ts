import { useEffect } from 'react';
import { usePriceStore } from '../store/priceStore';

export function useCryptoPrices() {
  const { setPrices, setLoading, setError } = usePriceStore();

  useEffect(() => {
    let isMounted = true;

    const loadPrices = async () => {
      if (!isMounted) return;

      setLoading(true);
      setError(null);

      try {
        // Use the new Binance-based API route
        // Disable cache for real-time updates
        const response = await fetch('/api/crypto/prices', {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
          }
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || errorData.details || 'Failed to fetch prices');
        }

        const prices = await response.json();
        if (isMounted) {
          setPrices(prices);
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

    // Set up interval to refresh prices every 1 second (1000ms)
    const interval = setInterval(loadPrices, 1000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [setPrices, setLoading, setError]);
}
