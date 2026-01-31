'use client';

import { useState, useMemo, useEffect, useCallback, memo } from 'react';
import { useRouter } from 'next/navigation';
import { useCryptoPrices } from '../../../hooks/useCryptoPrices';
import { usePriceStore } from '../../../store/priceStore';
import { LoadingSpinner } from '../../../components/shared/LoadingSpinner';
import { TrendingUp, TrendingDown, Star, Search, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { createClient } from '../../../lib/supabase/client';
import { DEFAULT_USER_ID } from '../../../lib/auth-utils';
import { CryptoPrice } from '../../../types';
import { formatPrice } from '../../../lib/formatPrice';

type SortField = 'name' | 'price' | 'change' | 'market_cap' | 'volume';
type SortDirection = 'asc' | 'desc';
type FilterType = 'all' | 'top_gainers' | 'top_losers' | 'high_price' | 'low_price' | 'high_mcap' | 'low_mcap';

export default function DashboardPage() {
  useCryptoPrices();
  const { prices, isLoading, error } = usePriceStore();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('market_cap');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [watchlistIds, setWatchlistIds] = useState<Set<string>>(new Set());
  const [watchlistLoading, setWatchlistLoading] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const supabase = createClient();
  const itemsPerPage = 10;
  const MAX_COINS = 100; // Only show up to 100 coins (criteria: 3h change > 5%)

  // Fetch watchlist on mount
  useEffect(() => {
    const fetchWatchlist = async () => {
      try {
        const { data, error } = await supabase
          .from('watchlist')
          .select('coin_id')
          .eq('user_id', DEFAULT_USER_ID);

        if (!error && data) {
          setWatchlistIds(new Set(data.map(item => item.coin_id)));
        }
      } catch (error) {
        console.error('Error fetching watchlist:', error);
      }
    };
    fetchWatchlist();
  }, [supabase]);

  // Watchlist toggle function
  const toggleWatchlist = async (coinId: string, coinSymbol: string) => {
    if (watchlistLoading) return;
    setWatchlistLoading(coinId);

    try {
      const isWatched = watchlistIds.has(coinId);

      if (isWatched) {
        // Remove from watchlist
        const { error } = await supabase
          .from('watchlist')
          .delete()
          .eq('user_id', DEFAULT_USER_ID)
          .eq('coin_id', coinId);

        if (error) throw error;

        setWatchlistIds(prev => {
          const next = new Set(prev);
          next.delete(coinId);
          return next;
        });
        toast.success(`${coinSymbol.toUpperCase()} removed from watchlist`);
      } else {
        // Add to watchlist
        const { error } = await supabase
          .from('watchlist')
          .insert({
            user_id: DEFAULT_USER_ID,
            coin_id: coinId,
            coin_symbol: coinSymbol.toUpperCase(),
          });

        if (error) {
          if (error.code === '23505') {
            // Already exists, just sync state
            setWatchlistIds(prev => new Set(prev).add(coinId));
          } else {
            throw error;
          }
        } else {
          setWatchlistIds(prev => new Set(prev).add(coinId));
          toast.success(`${coinSymbol.toUpperCase()} added to watchlist`);
        }
      }
    } catch (error) {
      console.error('Watchlist Error:', error);
      toast.error('Failed to update watchlist');
    } finally {
      setWatchlistLoading(null);
    }
  };

  const pricesList = Object.values(prices);

  // Pre-compute sorted arrays and top/bottom sets for filters (memoized)
  const filterSets = useMemo(() => {
    const validCoins = pricesList.filter(coin =>
      coin &&
      typeof coin.current_price === 'number' &&
      coin.current_price >= 0.01 &&
      Math.abs(coin.price_change_percentage_3h ?? coin.price_change_percentage_24h ?? 0) > 5
    );

    const sortedByPrice = [...validCoins].sort((a, b) => (b.current_price || 0) - (a.current_price || 0));
    const sortedByPriceLow = [...validCoins].sort((a, b) => (a.current_price || 0) - (b.current_price || 0));
    const sortedByMcap = [...validCoins].sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0));
    const sortedByMcapLow = [...validCoins].sort((a, b) => (a.market_cap || 0) - (b.market_cap || 0));

    const top20Percent = Math.max(1, Math.floor(sortedByPrice.length * 0.2));
    const bottom20Percent = Math.max(1, Math.floor(sortedByPriceLow.length * 0.2));
    const top20Mcap = Math.max(1, Math.floor(sortedByMcap.length * 0.2));
    const bottom20Mcap = Math.max(1, Math.floor(sortedByMcapLow.length * 0.2));

    return {
      highPriceSet: new Set(sortedByPrice.slice(0, top20Percent).map(c => c.id)),
      lowPriceSet: new Set(sortedByPriceLow.slice(0, bottom20Percent).map(c => c.id)),
      highMcapSet: new Set(sortedByMcap.slice(0, top20Mcap).map(c => c.id)),
      lowMcapSet: new Set(sortedByMcapLow.slice(0, bottom20Mcap).map(c => c.id)),
    };
  }, [pricesList]);

  // Filter and sort coins
  const filteredAndSortedCoins = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    let filtered = pricesList.filter((coin) => {
      // Strictly filter out coins with 0 or invalid price, or those that would display as $0.00 (< 0.01)
      if (!coin || typeof coin.current_price !== 'number' || coin.current_price < 0.01) return false;
      // Only show coins with 3h change more than 5% (absolute); fallback to 24h if 3h missing
      const changePct = coin.price_change_percentage_3h ?? coin.price_change_percentage_24h ?? 0;
      if (Math.abs(changePct) <= 5) return false;

      // Apply search filter first
      if (query) {
        const matchesSearch = (
          coin.name?.toLowerCase().includes(query) ||
          coin.symbol?.toLowerCase().includes(query) ||
          coin.id?.toLowerCase().includes(query)
        );
        if (!matchesSearch) return false;
      }

      // Apply high/low filters using pre-computed sets
      switch (filterType) {
        case 'top_gainers':
          return (coin.price_change_percentage_3h ?? coin.price_change_percentage_24h ?? 0) > 0;
        case 'top_losers':
          return (coin.price_change_percentage_3h ?? coin.price_change_percentage_24h ?? 0) < 0;
        case 'high_price':
          return filterSets.highPriceSet.has(coin.id);
        case 'low_price':
          return filterSets.lowPriceSet.has(coin.id);
        case 'high_mcap':
          return filterSets.highMcapSet.has(coin.id);
        case 'low_mcap':
          return filterSets.lowMcapSet.has(coin.id);
        case 'all':
        default:
          return true;
      }
    });

    // Sort
    filtered.sort((a, b) => {
      let aValue: number | string = 0;
      let bValue: number | string = 0;

      switch (sortField) {
        case 'name':
          aValue = a.name || '';
          bValue = b.name || '';
          break;
        case 'price':
          aValue = a.current_price || 0;
          bValue = b.current_price || 0;
          break;
        case 'change':
          aValue = a.price_change_percentage_3h ?? a.price_change_percentage_24h ?? 0;
          bValue = b.price_change_percentage_3h ?? b.price_change_percentage_24h ?? 0;
          break;
        case 'market_cap':
          aValue = a.market_cap || 0;
          bValue = b.market_cap || 0;
          break;
        case 'volume':
          aValue = a.volume_24h || 0;
          bValue = b.volume_24h || 0;
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

    return filtered.slice(0, MAX_COINS);
  }, [pricesList, searchQuery, sortField, sortDirection, filterType, filterSets]);

  // Pagination
  const totalPages = Math.ceil(filteredAndSortedCoins.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedCoins = filteredAndSortedCoins.slice(startIndex, endIndex);

  // Reset to page 1 when search, sort, or filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sortField, sortDirection, filterType]);

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  }, [sortField, sortDirection]);

  const SortButton = memo(({ field, children }: { field: SortField; children: React.ReactNode }) => {
    const isActive = sortField === field;
    return (
      <button
        onClick={() => handleSort(field)}
        className="flex items-center gap-1 hover:text-white transition-colors whitespace-nowrap"
      >
        <span>{children}</span>
        {isActive ? (
          <ArrowUpDown className={`w-3 h-3 ${sortDirection === 'asc' ? 'rotate-180' : ''}`} />
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-30" />
        )}
      </button>
    );
  });
  SortButton.displayName = 'SortButton';

  // Memoized coin row component to prevent unnecessary re-renders
  const CoinRow = memo(({
    coin,
    isWatched,
    isLoading,
    onRowClick,
    onWatchlistToggle
  }: {
    coin: CryptoPrice;
    isWatched: boolean;
    isLoading: boolean;
    onRowClick: () => void;
    onWatchlistToggle: () => void;
  }) => (
    <tr onClick={onRowClick} className="cursor-pointer hover:bg-gray-700">
      <td className="px-4 py-4 text-left whitespace-nowrap">{coin.name} ({coin.symbol})</td>
      <td className={`px-4 py-4 text-right whitespace-nowrap font-medium ${(coin.price_change_percentage_3h ?? coin.price_change_percentage_24h ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatPrice(coin.current_price)}</td>
      <td className={`px-4 py-4 text-right whitespace-nowrap ${(coin.price_change_percentage_3h ?? coin.price_change_percentage_24h ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
        {(coin.price_change_percentage_3h ?? coin.price_change_percentage_24h ?? 0) >= 0 ? '+' : ''}{(coin.price_change_percentage_3h ?? coin.price_change_percentage_24h)?.toFixed(2)}%
      </td>
      <td className="px-4 py-4 text-right whitespace-nowrap hidden md:table-cell">${coin.market_cap?.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
      <td className="px-4 py-4 text-right whitespace-nowrap hidden lg:table-cell">${coin.volume_24h?.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
      <td className="px-4 py-4 text-center">
        <button
          onClick={(e) => { e.stopPropagation(); onWatchlistToggle(); }}
          className="p-2 hover:bg-gray-600 rounded-full transition-colors"
          disabled={isLoading}
        >
          <Star className={`w-5 h-5 transition-colors ${isWatched ? 'text-yellow-400 fill-yellow-400' : 'text-gray-400 hover:text-yellow-400'}`} />
        </button>
      </td>
    </tr>
  ));
  CoinRow.displayName = 'CoinRow';

  return (
    <div>
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            Market Overview
            <span className="text-sm font-normal text-gray-400 bg-gray-800 px-3 py-1 rounded-full border border-gray-700">
              Total Coins: {filteredAndSortedCoins.length}
            </span>
          </h1>

          {/* Search */}
          <div className="relative flex-1 sm:max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search coins..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        {/* Filter Buttons */}
        <div className="flex flex-wrap gap-2">
          {['all', 'top_gainers', 'top_losers', 'high_price', 'low_price', 'high_mcap', 'low_mcap'].map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type as FilterType)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filterType === type
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
            >
              {type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-900 border border-red-700 text-red-200 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {isLoading && pricesList.length === 0 ? (
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner size="lg" />
        </div>
      ) : pricesList.length === 0 ? (
        <div className="text-center text-gray-400 py-12">
          <p>No cryptocurrency data available. Please check your API connection.</p>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-lg shadow-lg overflow-hidden border border-gray-700">
          {/* Simple Table (Truncated for brevity in tool call but logically complete) */}
          {/* Mobile Card View */}
          <div className="md:hidden space-y-4">
            {paginatedCoins.map(coin => (
              <div
                key={coin.id}
                onClick={() => router.push(`/dashboard/coins/${coin.id}`)}
                className="bg-gray-800 p-4 rounded-xl border border-gray-700 active:scale-[0.98] transition-transform"
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-900/30 flex items-center justify-center text-blue-400 font-bold border border-blue-500/20">
                      {coin.symbol[0]}
                    </div>
                    <div>
                      <h3 className="text-white font-bold">{coin.name}</h3>
                      <span className="text-xs text-gray-400 font-mono">{coin.symbol}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-mono font-medium ${(coin.price_change_percentage_3h ?? coin.price_change_percentage_24h ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatPrice(coin.current_price)}</div>
                    <div className={`text-xs font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1 mt-1 ${(coin.price_change_percentage_3h ?? coin.price_change_percentage_24h ?? 0) >= 0 ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'
                      }`}>
                      {(coin.price_change_percentage_3h ?? coin.price_change_percentage_24h ?? 0) >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {Math.abs(coin.price_change_percentage_3h ?? coin.price_change_percentage_24h ?? 0).toFixed(2)}%
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-3 border-t border-gray-700/50">
                  <div className="text-xs text-gray-500">
                    <span className="block">Vol: ${(coin.volume_24h / 1e6).toFixed(1)}M</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleWatchlist(coin.id, coin.symbol);
                    }}
                    className={`p-2 rounded-full transition-colors ${watchlistIds.has(coin.id)
                      ? 'bg-yellow-500/10 text-yellow-500'
                      : 'bg-gray-700 text-gray-400'
                      }`}
                  >
                    <Star className={`w-4 h-4 ${watchlistIds.has(coin.id) ? 'fill-current' : ''}`} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-700">
              <thead className="bg-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    <div className="flex items-center">
                      <SortButton field="name">Coin</SortButton>
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">
                    <div className="flex items-center justify-end">
                      <SortButton field="price">Price</SortButton>
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">
                    <div className="flex items-center justify-end">
                      <SortButton field="change">24h Change</SortButton>
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider hidden md:table-cell">
                    <div className="flex items-center justify-end">
                      <SortButton field="market_cap">Market Cap</SortButton>
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider hidden lg:table-cell">
                    <div className="flex items-center justify-end">
                      <SortButton field="volume">Volume</SortButton>
                    </div>
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">
                    <div className="flex items-center justify-center">
                      Watchlist
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-gray-800 divide-y divide-gray-700">
                {paginatedCoins.map(coin => (
                  <CoinRow
                    key={coin.id}
                    coin={coin}
                    isWatched={watchlistIds.has(coin.id)}
                    isLoading={watchlistLoading === coin.id}
                    onRowClick={() => router.push(`/dashboard/coins/${coin.id}`)}
                    onWatchlistToggle={() => toggleWatchlist(coin.id, coin.symbol)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex justify-between items-center px-4 py-4 border-t border-gray-600">
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-3 py-1 bg-gray-700 rounded disabled:opacity-50">Prev</button>
              <span>Page {currentPage} of {totalPages}</span>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-3 py-1 bg-gray-700 rounded disabled:opacity-50">Next</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
