import { useEffect } from 'react';
import { usePriceStore } from '@/store/priceStore';

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
        const response = await fetch('/api/crypto/prices', {
          next: { revalidate: 60 }, // Cache for 1 minute
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

    // Set up interval to refresh prices every 2 minutes
    const interval = setInterval(loadPrices, 120000); // 2 minutes = 120000ms

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [setPrices, setLoading, setError]);
}
