'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCryptoPrices } from '@/hooks/useCryptoPrices';
import { usePriceStore } from '@/store/priceStore';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { TrendingUp, TrendingDown, Star, Search, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'react-hot-toast';

type SortField = 'name' | 'price' | 'change' | 'market_cap' | 'volume';
type SortDirection = 'asc' | 'desc';
type FilterType = 'all' | 'top_gainers' | 'top_losers' | 'high_price' | 'low_price' | 'high_mcap' | 'low_mcap';

export default function DashboardPage() {
  useCryptoPrices();
  const { prices, isLoading, error } = usePriceStore();
  const supabase = createClient();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('market_cap');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [watchlistIds, setWatchlistIds] = useState<Set<string>>(new Set());
  const [watchlistLoading, setWatchlistLoading] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Helper function to ensure profile exists
  const ensureProfileExists = async (userId: string, email: string) => {
    try {
      // Check if profile exists (use maybeSingle to avoid 406 errors)
      const { data: existingProfile, error: selectError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();

      // If profile exists, we're done
      if (existingProfile) {
        return;
      }

      // If there was an error checking (not just "not found"), log it
      if (selectError && selectError.code !== 'PGRST116') {
        console.warn('Error checking profile:', selectError);
      }

      // Try to create profile if it doesn't exist
      const { data: newProfile, error: insertError } = await supabase
        .from('profiles')
        .insert({
          id: userId,
          email: email,
          balance_inr: 0,
          kyc_status: 'pending',
        })
        .select()
        .single();

      if (insertError) {
        // 23505 is unique constraint violation (profile already exists - race condition)
        if (insertError.code === '23505') {
          return; // Profile was created by another request, that's fine
        }
        
        // 42501 = permission denied (RLS policy missing)
        if (insertError.code === '42501') {
          console.error('❌ INSERT policy missing on profiles table!');
          console.error('📝 Run this SQL in Supabase SQL Editor:');
          console.error('   See file: ADD_PROFILE_INSERT_POLICY.sql');
          throw new Error('INSERT policy missing. Run ADD_PROFILE_INSERT_POLICY.sql in Supabase.');
        }
        
        // Log full error details
        console.error('Error creating profile:', {
          code: insertError.code,
          message: insertError.message,
          details: insertError.details,
          hint: insertError.hint,
        });
        
        throw insertError;
      }

      // Success
      if (newProfile) {
        console.log('✅ Profile created successfully');
      }
    } catch (error: any) {
      console.error('ensureProfileExists error:', {
        message: error?.message,
        code: error?.code,
      });
      throw error;
    }
  };

  // Load watchlist on mount
  useEffect(() => {
    const loadWatchlist = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Ensure profile exists (don't block if it fails)
        try {
          await ensureProfileExists(user.id, user.email || '');
        } catch (error: any) {
          console.error('Error ensuring profile exists:', {
            message: error?.message,
            code: error?.code,
            details: error?.details,
          });
          // Don't block watchlist loading if profile creation fails
          // The user can still view the list, just can't add to watchlist
        }

        const { data } = await supabase
          .from('watchlist')
          .select('coin_id')
          .eq('user_id', user.id);

        if (data) {
          setWatchlistIds(new Set(data.map(item => item.coin_id)));
        }
      } catch (error) {
        console.error('Error loading watchlist:', error);
      }
    };
    loadWatchlist();
  }, [supabase]);

  const priceArray = Object.values(prices);

  // Filter and sort coins
  const filteredAndSortedCoins = useMemo(() => {
    let filtered = priceArray.filter((coin) => {
      if (!coin || !coin.current_price) return false;
      const query = searchQuery.toLowerCase();
      const matchesSearch = (
        coin.name.toLowerCase().includes(query) ||
        coin.symbol.toLowerCase().includes(query) ||
        coin.id.toLowerCase().includes(query)
      );
      
      if (!matchesSearch) return false;

      // Apply high/low filters
      switch (filterType) {
        case 'top_gainers':
          return (coin.price_change_percentage_24h || 0) > 0;
        case 'top_losers':
          return (coin.price_change_percentage_24h || 0) < 0;
        case 'high_price':
          // Top 20% by price
          const sortedByPrice = [...priceArray].sort((a, b) => (b.current_price || 0) - (a.current_price || 0));
          const top20Percent = Math.max(1, Math.floor(sortedByPrice.length * 0.2));
          return sortedByPrice.slice(0, top20Percent).some(c => c.id === coin.id);
        case 'low_price':
          // Bottom 20% by price
          const sortedByPriceLow = [...priceArray].sort((a, b) => (a.current_price || 0) - (b.current_price || 0));
          const bottom20Percent = Math.max(1, Math.floor(sortedByPriceLow.length * 0.2));
          return sortedByPriceLow.slice(0, bottom20Percent).some(c => c.id === coin.id);
        case 'high_mcap':
          // Top 20% by market cap
          const sortedByMcap = [...priceArray].sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0));
          const top20Mcap = Math.max(1, Math.floor(sortedByMcap.length * 0.2));
          return sortedByMcap.slice(0, top20Mcap).some(c => c.id === coin.id);
        case 'low_mcap':
          // Bottom 20% by market cap
          const sortedByMcapLow = [...priceArray].sort((a, b) => (a.market_cap || 0) - (b.market_cap || 0));
          const bottom20Mcap = Math.max(1, Math.floor(sortedByMcapLow.length * 0.2));
          return sortedByMcapLow.slice(0, bottom20Mcap).some(c => c.id === coin.id);
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
          aValue = a.price_change_percentage_24h || 0;
          bValue = b.price_change_percentage_24h || 0;
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

    return filtered;
  }, [priceArray, searchQuery, sortField, sortDirection]);

  // Pagination
  const totalPages = Math.ceil(filteredAndSortedCoins.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedCoins = filteredAndSortedCoins.slice(startIndex, endIndex);

  // Reset to page 1 when search, sort, or filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sortField, sortDirection, filterType]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const toggleWatchlist = async (coinId: string, coinSymbol: string) => {
    if (watchlistLoading) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Please login to add to watchlist');
        return;
      }

      setWatchlistLoading(coinId);

      // Ensure profile exists before adding to watchlist
      try {
        await ensureProfileExists(user.id, user.email || '');
      } catch (error: any) {
        console.error('Failed to ensure profile exists:', error);
        // If profile creation fails, try to add to watchlist anyway
        // It might work if profile was created by trigger
        // If it fails, the error handler below will catch it
      }

      const isInWatchlist = watchlistIds.has(coinId);

      if (isInWatchlist) {
        // Remove from watchlist
        const { error } = await supabase
          .from('watchlist')
          .delete()
          .eq('user_id', user.id)
          .eq('coin_id', coinId);

        if (error) throw error;

        setWatchlistIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(coinId);
          return newSet;
        });
        toast.success('Removed from watchlist');
      } else {
        // Check if already in watchlist (double-check)
        if (watchlistIds.has(coinId)) {
          toast.error('Already in watchlist');
          return;
        }

        // Add to watchlist
        const { error } = await supabase
          .from('watchlist')
          .insert({
            user_id: user.id,
            coin_id: coinId,
            coin_symbol: coinSymbol,
          });

        if (error) {
          if (error.code === '23505' || error.code === 'PGRST116') {
            // Already exists - refresh watchlist
            const { data } = await supabase
              .from('watchlist')
              .select('coin_id')
              .eq('user_id', user.id);
            
            if (data) {
              setWatchlistIds(new Set(data.map(item => item.coin_id)));
            }
            toast.error('Already in watchlist');
          } else if (error.code === '23503') {
            // Foreign key constraint - profile doesn't exist
            toast.error('Profile not found. Please refresh the page.');
            console.error('Profile missing. User ID:', user.id);
          } else {
            throw error;
          }
          return;
        }

        setWatchlistIds(prev => new Set(prev).add(coinId));
        toast.success('Added to watchlist');
      }
    } catch (error: any) {
      console.error('Error toggling watchlist:', {
        code: error?.code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        fullError: error,
      });
      
      if (error?.code === '23503') {
        toast.error('Profile not found. Please refresh the page.');
      } else if (error?.code === '42501' || error?.message?.includes('row-level security') || error?.message?.includes('INSERT policy')) {
        toast.error(
          'Database policy missing. Run ADD_PROFILE_INSERT_POLICY.sql in Supabase SQL Editor.',
          { duration: 8000 }
        );
        console.error('❌ Missing INSERT policy on profiles table!');
        console.error('📝 Fix: Open ADD_PROFILE_INSERT_POLICY.sql and run it in Supabase SQL Editor');
      } else if (error?.code === '23505' || error?.code === 'PGRST116') {
        // Already exists or not found - refresh watchlist
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data } = await supabase
            .from('watchlist')
            .select('coin_id')
            .eq('user_id', user.id);
          if (data) {
            setWatchlistIds(new Set(data.map(item => item.coin_id)));
          }
        }
        toast.error('Already in watchlist');
      } else {
        toast.error(`Failed to update watchlist: ${error?.message || 'Unknown error'}`);
      }
    } finally {
      setWatchlistLoading(null);
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

  return (
    <div>
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <h1 className="text-3xl font-bold text-white">Market Overview</h1>
          
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
          <button
            onClick={() => setFilterType('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filterType === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilterType('top_gainers')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filterType === 'top_gainers'
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <TrendingUp className="w-4 h-4 inline mr-1" />
            Top Gainers
          </button>
          <button
            onClick={() => setFilterType('top_losers')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filterType === 'top_losers'
                ? 'bg-red-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <TrendingDown className="w-4 h-4 inline mr-1" />
            Top Losers
          </button>
          <button
            onClick={() => setFilterType('high_price')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filterType === 'high_price'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            High Price
          </button>
          <button
            onClick={() => setFilterType('low_price')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filterType === 'low_price'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Low Price
          </button>
          <button
            onClick={() => setFilterType('high_mcap')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filterType === 'high_mcap'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            High Market Cap
          </button>
          <button
            onClick={() => setFilterType('low_mcap')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filterType === 'low_mcap'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Low Market Cap
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900 border border-red-700 text-red-200 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {isLoading && priceArray.length === 0 ? (
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner size="lg" />
        </div>
      ) : priceArray.length === 0 ? (
        <div className="text-center text-gray-400 py-12">
          <p>No cryptocurrency data available. Please check your API connection.</p>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-lg shadow-lg overflow-hidden border border-gray-700">
          <div className="overflow-x-auto">
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
                    <div className="flex justify-end">
                      <SortButton field="market_cap">Market Cap</SortButton>
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider hidden lg:table-cell">
                    <div className="flex justify-end">
                      <SortButton field="volume">24h Volume</SortButton>
                    </div>
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Watchlist
                  </th>
                </tr>
              </thead>
              <tbody className="bg-gray-800 divide-y divide-gray-700">
                {filteredAndSortedCoins.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                      No coins found matching your search.
                    </td>
                  </tr>
                ) : (
                  paginatedCoins.map((coin) => {
                    if (!coin || !coin.current_price) return null;
                    
                    const isPositive = (coin.price_change_percentage_24h || 0) >= 0;
                    const isInWatchlist = watchlistIds.has(coin.id);
                    const isLoading = watchlistLoading === coin.id;

                    const handleRowClick = (e: React.MouseEvent) => {
                      // Don't navigate if clicking on the watchlist button
                      const target = e.target as HTMLElement;
                      if (target.closest('button[data-watchlist]')) {
                        return;
                      }
                      // Encode coinId to handle special characters
                      const encodedCoinId = encodeURIComponent(coin.id);
                      router.push(`/dashboard/coins/${encodedCoinId}`);
                    };

                    return (
                      <tr
                        key={coin.id}
                        onClick={handleRowClick}
                        className="hover:bg-gray-700 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div>
                              <div className="text-sm font-medium text-white hover:text-blue-400 transition-colors">
                                {coin.name}
                              </div>
                              <div className="text-sm text-gray-400">
                                {coin.symbol}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-right">
                          <div className="text-sm font-medium text-white">
                            ${coin.current_price.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
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
                              className={`text-sm font-medium ${
                                isPositive ? 'text-green-400' : 'text-red-400'
                              }`}
                            >
                              {isPositive ? '+' : ''}
                              {(coin.price_change_percentage_24h || 0).toFixed(2)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-right hidden md:table-cell">
                          <div className="text-sm text-gray-300">
                            ${(coin.market_cap || 0).toLocaleString('en-US')}
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-right hidden lg:table-cell">
                          <div className="text-sm text-gray-300">
                            ${(coin.volume_24h || 0).toLocaleString('en-US')}
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-center">
                          <button
                            data-watchlist
                            onClick={(e) => {
                              e.stopPropagation(); // Prevent row click
                              toggleWatchlist(coin.id, coin.symbol);
                            }}
                            disabled={isLoading}
                            className={`
                              p-2 rounded-lg transition-colors
                              ${isInWatchlist
                                ? 'text-yellow-400 hover:text-yellow-300'
                                : 'text-gray-400 hover:text-yellow-400'
                              }
                              ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                            `}
                            title={isInWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
                          >
                            <Star
                              className={`w-5 h-5 ${isInWatchlist ? 'fill-current' : ''}`}
                            />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          
          {/* Pagination */}
          {filteredAndSortedCoins.length > 0 && totalPages > 1 && (
            <div className="px-4 py-4 bg-gray-700 border-t border-gray-600 flex items-center justify-between">
              <div className="text-sm text-gray-300">
                Showing {startIndex + 1} to {Math.min(endIndex, filteredAndSortedCoins.length)} of {filteredAndSortedCoins.length} coins
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </button>
                
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum: number;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`px-3 py-2 rounded-lg transition-colors ${
                          currentPage === pageNum
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                
                <button
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
