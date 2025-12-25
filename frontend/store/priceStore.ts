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
      const updatedPrices = { ...state.prices };
      newPrices.forEach((price) => {
        updatedPrices[price.id] = price;
      });
      return {
        prices: updatedPrices,
        lastUpdated: new Date().toISOString(),
        error: null,
      };
    });
  },

  clearPrices: () => set({ prices: {}, lastUpdated: null, error: null }),
}));

