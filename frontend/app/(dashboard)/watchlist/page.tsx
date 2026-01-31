'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabase/client';
import { usePriceStore } from '../../../store/priceStore';
import { WatchlistItem, CryptoPrice } from '../../../types';
import { LoadingSpinner } from '../../../components/shared/LoadingSpinner';
import { Plus, X, Search, TrendingUp, TrendingDown, ArrowUpDown } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useCryptoPrices } from '../../../hooks/useCryptoPrices';
import { DEFAULT_USER_ID } from '../../../lib/auth-utils';

type SortField = 'name' | 'price' | 'change';
type SortDirection = 'asc' | 'desc';

export default function WatchlistPage() {
  const router = useRouter();
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newCoin, setNewCoin] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

  // Debounce search query to avoid excessive filtering
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const supabase = createClient();
  const { prices } = usePriceStore();
  useCryptoPrices();

  const fetchWatchlist = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('watchlist')
        .select('*')
        .eq('user_id', DEFAULT_USER_ID)
        .order('added_at', { ascending: false });

      if (error) {
        if (error.code === 'PGRST116' || error.message.includes('relation') || error.message.includes('does not exist')) {
          console.error('Database tables not found.');
          return;
        }
        throw error;
      }
      setWatchlist(data || []);
    } catch (error) {
      console.error('Error fetching watchlist:', error);
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchWatchlist();
  }, [fetchWatchlist]);

  // Fetch prices for coins not in the store (debounced and optimized)
  useEffect(() => {
    const fetchMissingPrices = async () => {
      if (watchlist.length === 0) return;

      const missingCoins = watchlist.filter(
        (item) => {
          // Check if price exists and has valid current_price
          const price = prices[item.coin_id];
          return !price || !price.current_price || price.current_price === 0;
        }
      );

      if (missingCoins.length === 0) return;

      const { setPrice } = usePriceStore.getState();

      // Fetch prices for missing coins with batched concurrency (increased batch size)
      const batchSize = 5;
      for (let i = 0; i < missingCoins.length; i += batchSize) {
        const batch = missingCoins.slice(i, i + batchSize);
        await Promise.allSettled(
          batch.map(async (item) => {
            if (!item.coin_id) return;

            try {
              // Handle USDT specially
              if (item.coin_id.toLowerCase() === 'tether' || item.coin_id.toLowerCase() === 'usdt') {
                const usdtPrice: CryptoPrice = {
                  id: item.coin_id,
                  symbol: 'USDT',
                  name: 'Tether',
                  current_price: 1.0,
                  price_change_24h: 0,
                  price_change_percentage_24h: 0,
                  market_cap: 0,
                  volume_24h: 0,
                  last_updated: new Date().toISOString(),
                };
                setPrice(usdtPrice);
                return;
              }

              // Try fetching by coin_id first
              let response = await fetch(`/api/crypto/coin-detail?coinId=${encodeURIComponent(item.coin_id)}`);

              // If that fails and we have a coin_symbol, try using that
              if (!response.ok && item.coin_symbol && item.coin_symbol.toLowerCase() !== item.coin_id.toLowerCase()) {
                response = await fetch(`/api/crypto/coin-detail?coinId=${encodeURIComponent(item.coin_symbol.toLowerCase())}`);
              }

              if (response.ok) {
                const coinDetail = await response.json();

                // Use the coin_id from watchlist to maintain consistency
                const cryptoPrice: CryptoPrice = {
                  id: item.coin_id, // Use watchlist coin_id, not the one from API
                  symbol: coinDetail.symbol,
                  name: coinDetail.name || item.coin_symbol || item.coin_id,
                  current_price: coinDetail.current_price,
                  price_change_24h: coinDetail.price_change_24h,
                  price_change_percentage_24h: coinDetail.price_change_percentage_24h,
                  market_cap: coinDetail.market_cap || 0,
                  volume_24h: coinDetail.volume_24h,
                  last_updated: coinDetail.last_updated,
                };
                setPrice(cryptoPrice);
              } else {
                // Coin not found or unavailable - set placeholder with price 0
                const placeholderPrice: CryptoPrice = {
                  id: item.coin_id,
                  symbol: item.coin_symbol || item.coin_id.toUpperCase(),
                  name: item.coin_symbol || item.coin_id,
                  current_price: 0,
                  price_change_24h: 0,
                  price_change_percentage_24h: 0,
                  market_cap: 0,
                  volume_24h: 0,
                  last_updated: new Date().toISOString(),
                };
                setPrice(placeholderPrice);
              }
            } catch (error) {
              console.error(`Failed to fetch price for ${item.coin_id}:`, error);
              // Set placeholder on error too
              const placeholderPrice: CryptoPrice = {
                id: item.coin_id,
                symbol: item.coin_symbol || item.coin_id.toUpperCase(),
                name: item.coin_symbol || item.coin_id,
                current_price: 0,
                price_change_24h: 0,
                price_change_percentage_24h: 0,
                market_cap: 0,
                volume_24h: 0,
                last_updated: new Date().toISOString(),
              };
              setPrice(placeholderPrice);
            }
          })
        );

        // Rate limiting: wait between batches (reduced delay)
        if (i + batchSize < missingCoins.length) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
    };

    // Debounce the fetch to avoid excessive calls
    const timeoutId = setTimeout(() => {
      if (!isLoading && watchlist.length > 0) {
        fetchMissingPrices();
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [watchlist, prices, isLoading]);


  const addToWatchlist = async () => {
    if (!newCoin.trim()) {
      toast.error('Please enter a coin ID');
      return;
    }

    try {
      const coinId = newCoin.toLowerCase().trim();
      const coinSymbol = prices[coinId]?.symbol || coinId.toUpperCase();

      const { error } = await supabase.from('watchlist').insert({
        user_id: DEFAULT_USER_ID,
        coin_id: coinId,
        coin_symbol: coinSymbol,
      });

      if (error) {
        if (error.code === '23505') {
          toast.error('Coin already in watchlist');
        } else {
          throw error;
        }
        return;
      }

      toast.success('Added to watchlist');
      setNewCoin('');
      fetchWatchlist();
    } catch (error) {
      toast.error('Failed to add to watchlist');
    }
  };

  const removeFromWatchlist = async (id: string) => {
    try {
      const { error } = await supabase.from('watchlist').delete().eq('id', id);

      if (error) throw error;

      toast.success('Removed from watchlist');
      fetchWatchlist();
    } catch (error) {
      toast.error('Failed to remove from watchlist');
    }
  };

  // Filter and sort watchlist
  const filteredAndSortedWatchlist = useMemo(() => {
    let filtered = watchlist.filter((item) => {
      const query = debouncedSearchQuery.toLowerCase();
      if (!query) return true;
      return (
        item.coin_symbol.toLowerCase().includes(query) ||
        item.coin_id.toLowerCase().includes(query)
      );
    });

    // Sort
    filtered.sort((a, b) => {
      const priceA = prices[a.coin_id];
      const priceB = prices[b.coin_id];

      let aValue: number | string = 0;
      let bValue: number | string = 0;

      switch (sortField) {
        case 'name':
          aValue = a.coin_symbol || '';
          bValue = b.coin_symbol || '';
          break;
        case 'price':
          aValue = priceA?.current_price || 0;
          bValue = priceB?.current_price || 0;
          break;
        case 'change':
          aValue = priceA?.price_change_percentage_24h || 0;
          bValue = priceB?.price_change_percentage_24h || 0;
          break;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      return sortDirection === 'asc'
        ? (aValue as number) - (bValue as number)
        : (bValue as number) - (aValue as number);
    });

    return filtered;
  }, [watchlist, prices, debouncedSearchQuery, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const SortButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <button
      onClick={() => handleSort(field)}
      className="flex items-center gap-1 hover:text-white transition-colors"
    >
      <span>{children}</span>
      {sortField === field && (
        <ArrowUpDown className={`w-3 h-3 ${sortDirection === 'asc' ? 'rotate-180' : ''}`} />
      )}
    </button>
  );

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 8,
    }).format(price);
  };

  const formatLargeNumber = (num: number) => {
    if (num >= 1e9) {
      return `$${(num / 1e9).toFixed(2)}B`;
    } else if (num >= 1e6) {
      return `$${(num / 1e6).toFixed(2)}M`;
    } else if (num >= 1e3) {
      return `$${(num / 1e3).toFixed(2)}K`;
    }
    return `$${num.toFixed(2)}`;
  };

  const handleRowClick = (coinId: string, e: React.MouseEvent) => {
    // Don't navigate if clicking on the remove button
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('svg')) {
      return;
    }
    router.push(`/dashboard/coins/${coinId}`);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h1 className="text-3xl font-bold text-white">Watchlist</h1>

        {/* Search */}
        <div className="relative flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search watchlist..."
            className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {/* List View */}
      {watchlist.length === 0 ? (
        <div className="bg-gray-800 rounded-lg shadow-lg p-12 border border-gray-700 text-center">
          <p className="text-gray-400 text-lg">
            Your watchlist is empty. Add coins to track their prices.
          </p>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700">
          {/* Mobile Card View */}
          <div className="md:hidden space-y-4 p-4">
            {filteredAndSortedWatchlist.map((item) => {
              const price = prices[item.coin_id];
              // If price is missing or invalid, skip rendering this card for now
              if (!price || !price.current_price) return null;

              const isPositive = (price.price_change_percentage_24h || 0) >= 0;

              return (
                <div
                  key={item.id}
                  onClick={(e) => handleRowClick(item.coin_id, e)}
                  className="bg-gray-700/30 p-4 rounded-xl border border-gray-600 active:scale-[0.98] transition-transform"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-900/20 flex items-center justify-center text-blue-400 font-bold border border-blue-500/10">
                        {item.coin_symbol[0]}
                      </div>
                      <div>
                        <h3 className="text-white font-bold">{item.coin_symbol}</h3>
                        <span className="text-xs text-gray-400">{item.coin_id}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-white font-mono font-medium">
                        {price ? formatPrice(price.current_price) : 'Loading...'}
                      </div>
                      {price && (
                        <div className={`text-xs font-bold inline-flex items-center gap-1 ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                          {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {(price.price_change_percentage_24h || 0).toFixed(2)}%
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-3 border-t border-gray-600/50 mt-2">
                    <div className="text-xs text-gray-500">
                      {price?.market_cap ? `MCap: ${formatLargeNumber(price.market_cap)}` : ''}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromWatchlist(item.id);
                      }}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-900/20 text-red-400 hover:bg-red-900/30 transition-colors text-xs font-medium"
                    >
                      <X className="w-3.5 h-3.5" />
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-700">
              <thead className="bg-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    <SortButton field="name">Coin</SortButton>
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">
                    <div className="flex justify-end">
                      <SortButton field="price">Price</SortButton>
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">
                    <div className="flex justify-end">
                      <SortButton field="change">24h Change</SortButton>
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider hidden md:table-cell">
                    <div className="flex justify-end">Market Cap</div>
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider hidden lg:table-cell">
                    <div className="flex justify-end">24h Volume</div>
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-gray-800 divide-y divide-gray-700">
                {filteredAndSortedWatchlist.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                      No coins found matching your search.
                    </td>
                  </tr>
                ) : (
                  filteredAndSortedWatchlist.map((item) => {
                    const price = prices[item.coin_id];
                    // Show loading only if price exists but is 0 (unsupported) or if price doesn't exist yet
                    if (!price || (price.current_price === 0 && price.last_updated)) {
                      return (
                        <tr
                          key={item.id}
                          className="hover:bg-gray-700 transition-colors cursor-pointer"
                          onClick={(e) => handleRowClick(item.coin_id, e)}
                        >
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div>
                              <div className="text-sm font-medium text-white">
                                {item.coin_symbol}
                              </div>
                              <div className="text-sm text-gray-400">{item.coin_id}</div>
                            </div>
                          </td>
                          <td colSpan={5} className="px-4 py-4 text-center text-gray-400">
                            {price && price.current_price === 0
                              ? 'Not available on Binance'
                              : 'Loading price...'}
                          </td>
                        </tr>
                      );
                    }

                    // Skip if price is still loading (no price data yet)
                    if (!price.current_price) {
                      return null;
                    }

                    const isPositive = (price.price_change_percentage_24h || 0) >= 0;

                    return (
                      <tr
                        key={item.id}
                        className="hover:bg-gray-700 transition-colors cursor-pointer"
                        onClick={(e) => handleRowClick(item.coin_id, e)}
                      >
                        <td className="px-4 py-4 whitespace-nowrap">
                          <div>
                            <div className="text-sm font-medium text-white">
                              {item.coin_symbol}
                            </div>
                            <div className="text-sm text-gray-400">{item.coin_id}</div>
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-right">
                          <div className="text-sm font-medium text-white">
                            {formatPrice(price.current_price)}
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-right">
                          <div className="flex items-center justify-end gap-1">
                            {isPositive ? (
                              <TrendingUp className="w-4 h-4 text-green-500" />
                            ) : (
                              <TrendingDown className="w-4 h-4 text-red-500" />
                            )}
                            <span
                              className={`text-sm font-medium ${isPositive ? 'text-green-400' : 'text-red-400'
                                }`}
                            >
                              {isPositive ? '+' : ''}
                              {(price.price_change_percentage_24h || 0).toFixed(2)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-right hidden md:table-cell">
                          <div className="text-sm text-gray-300">
                            {formatLargeNumber(price.market_cap || 0)}
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-right hidden lg:table-cell">
                          <div className="text-sm text-gray-300">
                            {formatLargeNumber(price.volume_24h || 0)}
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => removeFromWatchlist(item.id)}
                            className="text-red-400 hover:text-red-300 transition-colors p-2 rounded-lg hover:bg-red-900/20"
                            title="Remove from watchlist"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}