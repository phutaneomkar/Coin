import { create } from 'zustand';
import { CryptoPrice } from '../types';

interface PriceStore {
  prices: Record<string, CryptoPrice>;
  isLoading: boolean;
  error: string | null;
  lastUpdated: string | null;
  setPrices: (prices: CryptoPrice[]) => void;
  setPrice: (price: CryptoPrice) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  getPrice: (coinId: string) => CryptoPrice | null;
  updatePrices: (prices: CryptoPrice[]) => void;
  clearPrices: () => void;
}

export const usePriceStore = create<PriceStore>((set, get) => ({
  prices: {},
  isLoading: false,
  error: null,
  lastUpdated: null,

  setPrices: (prices) => {
    const priceMap: Record<string, CryptoPrice> = {};
    prices.forEach((price) => {
      priceMap[price.id] = price;
    });
    set({
      prices: priceMap,
      lastUpdated: new Date().toISOString(),
      error: null,
    });
  },

  setPrice: (price) =>
    set((state) => ({
      prices: { ...state.prices, [price.id]: price },
      lastUpdated: new Date().toISOString(),
      error: null,
    })),

  setLoading: (loading) => set({ isLoading: loading }),

  setError: (error) => set({ error }),

  getPrice: (coinId) => {
    const state = get();
    return state.prices[coinId] || null;
  },

  updatePrices: (newPrices) => {
    set((state) => {
      let hasChanges = false;
      const updatedPrices = { ...state.prices };

      newPrices.forEach((price) => {
        const existing = updatedPrices[price.id];
        const merged = {
          ...price,
          price_change_percentage_3h: price.price_change_percentage_3h ?? existing?.price_change_percentage_3h,
        };
        // Update if new data or price/percent changed (use small epsilon for float comparison)
        const priceChanged = existing
          ? Math.abs((existing.current_price || 0) - (merged.current_price || 0)) > 1e-10
          : true;
        const pctChanged = existing
          ? Math.abs((existing.price_change_percentage_24h || 0) - (merged.price_change_percentage_24h || 0)) > 1e-6
          : true;
        if (priceChanged || pctChanged || !existing) {
          updatedPrices[price.id] = merged;
          hasChanges = true;
        }
      });

      if (!hasChanges) return state;

      return {
        prices: updatedPrices,
        lastUpdated: new Date().toISOString(),
        error: null,
      };
    });
  },

  clearPrices: () => set({ prices: {}, lastUpdated: null, error: null }),
}));

