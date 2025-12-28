'use client';

import { useState, useEffect, useMemo, useRef, Suspense, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '../../../lib/supabase/client';
import { Order } from '../../../types';
import { LoadingSpinner } from '../../../components/shared/LoadingSpinner';
import { OrderForm } from '../../../components/orders/OrderForm';
import { usePriceStore } from '../../../store/priceStore';
import { TradingModal } from '../../../components/coins/TradingModal';
import { toast } from 'react-hot-toast';
import { useCryptoPrices } from '../../../hooks/useCryptoPrices';
import { DEFAULT_USER_ID } from '../../../lib/auth-utils';

function OrdersContent() {
  // Enable real-time price updates
  useCryptoPrices();

  const searchParams = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<'orders' | 'portfolio'>('orders');
  const [sellModalOpen, setSellModalOpen] = useState(false);
  const [selectedCoin, setSelectedCoin] = useState<{ coinId: string; coinSymbol: string; currentPrice: number } | null>(null);
  const [holdingsData, setHoldingsData] = useState<Record<string, { quantity: number; average_buy_price: number }>>({});
  const [userBalance, setUserBalance] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const supabase = createClient();
  const { prices } = usePriceStore();

  // Calculate locked balance from pending buy orders
  const lockedBalance = useMemo(() => {
    return orders
      .filter(o => o.order_status === 'pending' && o.order_type === 'buy')
      .reduce((sum, o) => sum + (o.total_amount || 0), 0);
  }, [orders]);

  const availableBalance = Math.max(0, userBalance - lockedBalance);

  // Check if we have action param (from buy/sell buttons)
  const hasActionParam = searchParams?.get('action') !== null;

  const fetchUserBalance = useCallback(async () => {
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('balance_inr')
        .eq('id', DEFAULT_USER_ID)
        .maybeSingle();

      if (error) {
        console.error('Error fetching balance:', error);
        return;
      }

      if (profile) {
        setUserBalance(parseFloat(profile.balance_inr?.toString() || '0'));
      }
    } catch (error) {
      console.error('Error fetching balance:', error);
    }
  }, [supabase]);

  const fetchHoldings = useCallback(async () => {
    try {
      const { data: holdings, error } = await supabase
        .from('holdings')
        .select('coin_id, quantity, average_buy_price, last_updated')
        .eq('user_id', DEFAULT_USER_ID)
        .gt('quantity', 0)
        .order('last_updated', { ascending: false });

      if (error) {
        console.error('Error fetching holdings:', error);
        return;
      }

      const holdingsMap: Record<string, { quantity: number; average_buy_price: number }> = {};
      if (holdings && holdings.length > 0) {
        holdings.forEach(holding => {
          const coinId = holding.coin_id?.toLowerCase()?.trim() || '';
          if (coinId) {
            const qty = parseFloat(holding.quantity.toString());
            if (qty > 0 && !isNaN(qty)) {
              holdingsMap[coinId] = {
                quantity: qty,
                average_buy_price: parseFloat(holding.average_buy_price.toString()),
              };
            }
          }
        });
      }
      setHoldingsData(holdingsMap);
    } catch (error) {
      console.error('Error fetching holdings:', error);
    }
  }, [supabase]);

  const fetchOrders = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', DEFAULT_USER_ID)
        .order('order_date', { ascending: false });

      if (error) {
        if (error.code === 'PGRST116' || error.message.includes('relation') || error.message.includes('does not exist')) {
          console.error('Database tables not found.');
          return;
        }
        throw error;
      }

      const pendingMarketOrders = (data || []).filter(
        order => order.order_status === 'pending' && order.order_mode === 'market'
      );

      if (pendingMarketOrders.length > 0) {
        const orderIds = pendingMarketOrders.map(order => order.id);
        await supabase.from('orders').update({ order_status: 'completed' }).in('id', orderIds);
        const { data: updatedData } = await supabase
          .from('orders')
          .select('*')
          .eq('user_id', DEFAULT_USER_ID)
          .order('order_date', { ascending: false });
        setOrders(updatedData || []);
      } else {
        setOrders(data || []);
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([fetchOrders(), fetchHoldings(), fetchUserBalance()]);
    setIsRefreshing(false);
  }, [fetchOrders, fetchHoldings, fetchUserBalance]);

  useEffect(() => {
    refreshAll();

    // Check and execute limit orders every 10 seconds
    const checkLimitOrders = async () => {
      try {
        await fetch('/api/orders/check-limits', { method: 'GET' });
        refreshAll();
      } catch (error) {
        console.error('Error checking limit orders:', error);
      }
    };

    // Manual check for debugging
    const checkLimitOrdersManual = async () => {
      try {
        const toastId = toast.loading('Checking limit orders...');
        const res = await fetch('/api/orders/check-limits', { method: 'GET' });
        const data = await res.json();

        console.log('Manual Limit Check Result:', data);

        if (data.success) {
          if (data.executed > 0) {
            toast.success(`Executed ${data.executed} orders!`, { id: toastId });
            refreshAll();
          } else {
            toast.success('No orders executed (conditions not met)', { id: toastId });
          }

          if (data.logs && data.logs.length > 0) {
            console.log('Limit Check Logs:', data.logs);
            // Show logs in a persistent toast for debugging
            toast((t) => (
              <div onClick={() => toast.dismiss(t.id)} className="cursor-pointer">
                <p className="font-bold border-b border-gray-600 mb-1 pb-1">Debug Logs (Click to dismiss):</p>
                <div className="max-h-32 overflow-y-auto text-xs font-mono">
                  {data.logs.map((log: string, i: number) => (
                    <div key={i} className="mb-1">{log}</div>
                  ))}
                </div>
              </div>
            ), { duration: 6000, id: 'debug-logs' });
          }
        } else {
          toast.error(`Check failed: ${data.error}`, { id: toastId });
        }
      } catch (error) {
        console.error('Error checking limit orders:', error);
        toast.error('Failed to check limit orders');
      }
    };

    // Initial check
    // checkLimitOrders(); // Handled by global LimitOrderChecker

    // Set up interval to refresh data every 10 seconds
    const interval = setInterval(refreshAll, 10000);

    // Make manual check available globally for easy console triggering if needed
    (window as any).checkLimitOrders = checkLimitOrdersManual;

    // Listen for order-placed events from other pages
    const handleOrderPlaced = async () => {
      await new Promise(resolve => setTimeout(resolve, 2000));
      await refreshAll();
    };

    window.addEventListener('order-placed', handleOrderPlaced);

    return () => {
      clearInterval(interval);
      window.removeEventListener('order-placed', handleOrderPlaced);
    };
  }, []);


  // Fetch current prices for all orders and holdings (pending and completed for portfolio)
  useEffect(() => {
    const fetchCurrentPrices = async () => {
      const priceMap: Record<string, number> = {};

      // Get unique coin IDs from both orders and holdings
      const orderCoinIds = orders.map(order => order.coin_id).filter(Boolean);
      const holdingsCoinIds = Object.keys(holdingsData);
      const uniqueCoinIds = [...new Set([...orderCoinIds, ...holdingsCoinIds])];

      if (uniqueCoinIds.length === 0) return;

      // Get prices from store first
      uniqueCoinIds.forEach(coinId => {
        const normalizedId = coinId.toLowerCase();
        const price = prices[normalizedId] || prices[coinId];
        if (price && price.current_price) {
          priceMap[normalizedId] = price.current_price;
          priceMap[coinId] = price.current_price; // Also store with original case
        }
      });

      // Fetch missing prices
      const missingCoins = uniqueCoinIds.filter(
        coinId => !priceMap[coinId.toLowerCase()] && !priceMap[coinId]
      );

      for (const coinId of missingCoins) {
        try {
          const response = await fetch(
            `/api/crypto/coin-detail?coinId=${encodeURIComponent(coinId)}`
          );
          if (response.ok) {
            const coinDetail = await response.json();
            const normalizedId = coinId.toLowerCase();
            priceMap[normalizedId] = coinDetail.current_price || 0;
            priceMap[coinId] = coinDetail.current_price || 0; // Also store with original case
          }
        } catch (error) {
          console.error(`Failed to fetch price for ${coinId}:`, error);
        }
      }

      setCurrentPrices(priceMap);
    };

    if (orders.length > 0 || Object.keys(holdingsData).length > 0) {
      fetchCurrentPrices();
    }
  }, [orders, holdingsData, prices]);


  // Calculate portfolio data - ONLY use holdings table data (no fallback to orders)
  // This ensures that cleaned-up holdings don't reappear from old orders
  const portfolioData = useMemo(() => {
    const timestamp = new Date().toISOString();
    console.log('Portfolio: Calculating portfolio data', {
      holdingsDataCount: Object.keys(holdingsData).length,
      ordersCount: orders.length,
      currentPricesCount: Object.keys(currentPrices).length,
      holdingsDataKeys: Object.keys(holdingsData),
      timestamp
    });

    const portfolioDataMap = new Map<string, any>();

    // ONLY use holdings table data - no fallback to orders
    // If holdings table is empty, portfolio should be empty (not recalculated from orders)
    if (Object.keys(holdingsData).length > 0) {
      console.log('Portfolio: Using holdings table data', { holdingsData, timestamp });
      Object.entries(holdingsData).forEach(([coinId, holding]) => {
        // Skip holdings with 0 or negative quantity (shouldn't happen, but safety check)
        if (holding.quantity <= 0) {
          console.warn('Portfolio: Skipping holding with 0 or negative quantity', { coinId, quantity: holding.quantity, timestamp });
          return;
        }

        // Additional validation: ensure quantity is a valid positive number
        const qty = parseFloat(holding.quantity.toString());
        if (isNaN(qty) || qty <= 0) {
          console.warn('Portfolio: Invalid quantity detected, skipping', { coinId, quantity: holding.quantity, parsed: qty, timestamp });
          return;
        }

        // Try both lowercase and original case for price lookup
        const normalizedCoinId = coinId.toLowerCase();
        const currentPrice = currentPrices[normalizedCoinId] || currentPrices[coinId] || 0;
        const orderPrice = holding.average_buy_price;

        // Use validated quantity (already validated above)
        // Subtract PENDING SELL ORDERS from the displayed quantity
        // This ensures the portfolio shows "Available" quantity, not total quantity
        const pendingSellQty = orders
          .filter(
            o => o.order_status === 'pending' &&
              o.order_type === 'sell' &&
              (o.coin_id?.toLowerCase() === normalizedCoinId || o.coin_id === coinId)
          )
          .reduce((sum, o) => sum + o.quantity, 0);

        const availableQty = Math.max(0, qty - pendingSellQty);

        // Calculate values for Available
        const orderValue = availableQty * orderPrice;
        const currentValue = availableQty * currentPrice;

        // Calculate values for Locked
        const lockedValue = pendingSellQty * currentPrice;
        const lockedOrderValue = pendingSellQty * orderPrice;

        // Find matching order for coin_symbol (try case-insensitive)
        const matchingOrder = orders.find(
          o => o.order_status === 'completed' &&
            o.order_type === 'buy' &&
            (o.coin_id?.toLowerCase() === normalizedCoinId || o.coin_id === coinId)
        );

        const coinSymbol = matchingOrder?.coin_symbol || coinId.toUpperCase();

        // Use validated quantity
        const validatedQuantity = availableQty;

        const portfolioItem = {
          id: matchingOrder?.id || coinId,
          coin_id: normalizedCoinId, // Use normalized for consistency
          coin_symbol: coinSymbol,
          quantity: validatedQuantity,
          lockedQuantity: pendingSellQty, // Track locked quantity
          orderPrice,
          orderValue: validatedQuantity * orderPrice,
          lockedOrderValue, // Track locked order value
          currentPrice,
          currentValue: validatedQuantity * currentPrice,
          lockedValue, // Track locked current value
          profitLoss: (validatedQuantity * currentPrice) - (validatedQuantity * orderPrice),
          profitLossPercent: orderValue > 0 ? (((validatedQuantity * currentPrice) - (validatedQuantity * orderPrice)) / (validatedQuantity * orderPrice)) * 100 : 0,
        };

        console.log('Portfolio: Adding holding to portfolio', {
          coinId,
          originalQuantity: holding.quantity,
          pendingSellQty,
          availableQty
        });

        // Group by Symbol to merge duplicates (e.g., 'bitcoin' and 'btc')
        const symbolKey = coinSymbol.toUpperCase();

        if (portfolioDataMap.has(symbolKey)) {
          const existing = portfolioDataMap.get(symbolKey);

          // Merge logic
          existing.quantity += portfolioItem.quantity;
          existing.lockedQuantity += portfolioItem.lockedQuantity;
          existing.orderValue += portfolioItem.orderValue;
          existing.lockedOrderValue += portfolioItem.lockedOrderValue;
          existing.currentValue += portfolioItem.currentValue;
          existing.lockedValue += portfolioItem.lockedValue;

          // Recalculate Average Buy Price based on total substituted value
          const totalQty = existing.quantity + existing.lockedQuantity;
          const totalInvested = existing.orderValue + existing.lockedOrderValue;
          existing.orderPrice = totalQty > 0 ? totalInvested / totalQty : 0;

          // Recalculate P&L
          const totalCurrentVal = existing.currentValue + existing.lockedValue;
          existing.profitLoss = totalCurrentVal - totalInvested;
          existing.profitLossPercent = totalInvested > 0 ? (existing.profitLoss / totalInvested) * 100 : 0;

          // If the new item has a larger quantity, maybe prefer its ID for selling? 
          // For now, keep the ID that was encountered first usually creates a stable list.
          // But if we want to sell the one with actual balance, we might need logic.
          // Let's stick to the first one for simplicity unless we see issues.

          console.log(`Portfolio: Merged duplicate for ${symbolKey}`, existing);
        } else {
          portfolioDataMap.set(symbolKey, portfolioItem);
        }
      });
    } else {
      // No holdings data - portfolio is empty (do NOT fallback to orders)
      // This ensures cleaned-up holdings don't reappear
      console.log('Portfolio: No holdings data - portfolio is empty (not using orders fallback)');
    }

    // Convert map to array and filter out any invalid entries
    const portfolioArray = Array.from(portfolioDataMap.values()).filter(item => {
      // Double-check: remove any items with 0 or negative quantity
      // BUT keep them if they have locked quantity (so total value is correct)
      if (item.quantity <= 0 && item.lockedQuantity <= 0) {
        console.warn('Portfolio: Filtering out item with invalid quantity', item);
        return false;
      }
      return true;
    });

    console.log('Portfolio: Final portfolio data', {
      count: portfolioArray.length,
      items: portfolioArray,
      coinIds: portfolioArray.map(i => i.coin_id),
      timestamp: new Date().toISOString()
    });
    return portfolioArray;
  }, [holdingsData, currentPrices, orders]);

  // Total Value includes BOTH Available and Locked assets
  // This ensures the "Total Portfolio Value" doesn't drop when a user places a limit sell order
  const totalPortfolioValue = useMemo(() =>
    portfolioData.reduce((sum, item) => sum + item.currentValue + (item.lockedValue || 0), 0),
    [portfolioData]
  );
  const totalOrderValue = useMemo(() =>
    portfolioData.reduce((sum, item) => sum + item.orderValue + (item.lockedOrderValue || 0), 0),
    [portfolioData]
  );
  const totalProfitLoss = useMemo(() =>
    totalPortfolioValue - totalOrderValue,
    [totalPortfolioValue, totalOrderValue]
  );
  const totalProfitLossPercent = useMemo(() =>
    totalOrderValue > 0 ? (totalProfitLoss / totalOrderValue) * 100 : 0,
    [totalProfitLoss, totalOrderValue]
  );

  // Sync holdings on mount if needed (one-time migration)
  const hasSyncedRef = useRef(false);
  const isSyncingRef = useRef(false); // Prevent concurrent syncs

  useEffect(() => {
    const syncHoldings = async () => {
      // Prevent multiple syncs or concurrent syncs
      if (hasSyncedRef.current || isSyncingRef.current) return;

      try {
        // Only sync if we have orders, and we're not loading
        if (!isLoading && orders.length > 0) {
          isSyncingRef.current = true; // Lock sync
          hasSyncedRef.current = true; // Mark as synced before making the call

          const response = await fetch('/api/orders/sync-holdings', { method: 'POST' });
          const data = await response.json();

          if (data.success && data.synced > 0) {
            await fetchHoldings(); // Refresh holdings after sync
          } else {
            // If sync returns 0 updates, we still consider it "done" for this session to avoid loop
            hasSyncedRef.current = true;
          }

          isSyncingRef.current = false; // Unlock sync
        }
      } catch (error) {
        console.error('Error syncing holdings:', error);
        hasSyncedRef.current = false; // Reset on error
        isSyncingRef.current = false; // Unlock sync
      }
    };

    // Only run once when component mounts and data is loaded
    if (!isLoading) {
      syncHoldings();
    }
  }, [isLoading]); // Only depend on loading state - run once when loading completes

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // Cancel pending order
  const cancelOrder = async (orderId: string) => {
    try {
      const toastId = toast.loading('Cancelling order...');
      const response = await fetch('/api/orders/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        toast.success('Order cancelled successfully', { id: toastId });
        // Refresh data to update UI and unlock funds/holdings
        // Wait a small delay for DB propagation
        setTimeout(() => refreshAll(), 500);
      } else {
        toast.error(data.error || 'Failed to cancel order', { id: toastId });
      }
    } catch (error) {
      console.error('Error cancelling order:', error);
      toast.error('Error cancelling order');
    }
  };





  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Orders</h1>
          <p className="text-sm text-gray-400 mt-1">
            Available Balance: <span className="text-white font-semibold">${availableBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            {lockedBalance > 0 && (
              <span className="text-yellow-500 ml-1 text-xs">
                (+${lockedBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Locked)
              </span>
            )}
            {' | '}
            Holdings: <span className="text-white font-semibold">{Object.keys(holdingsData).length} coins</span>
          </p>
        </div>
      </div>

      {/* Order Form - Only show if URL has action param (from buy/sell buttons) */}
      {hasActionParam && (
        <div className="mb-6">
          <OrderForm onOrderPlaced={async () => {
            // Show loading toast
            const loadingToast = toast.loading('Updating portfolio...', { id: 'order-update' });

            // Wait longer for database to update
            await new Promise(resolve => setTimeout(resolve, 3000));
            await refreshAll();
            try {
              const res = await fetch('/api/orders/cleanup-holdings', { method: 'POST' });
              const data = await res.json();
            } catch { }
            await fetchHoldings();

            toast.success('Order placed! Portfolio and balance updated.', { id: 'order-update' });
          }} />
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 border-b border-gray-700">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('orders')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === 'orders'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-gray-400 hover:text-gray-300'
              }`}
          >
            Order History
          </button>
          <button
            onClick={() => setActiveTab('portfolio')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === 'portfolio'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-gray-400 hover:text-gray-300'
              }`}
          >
            Total Portfolio
          </button>
        </div>
      </div>

      {/* Portfolio Tab */}
      {activeTab === 'portfolio' && (
        <div className="space-y-6">
          {/* Portfolio Summary */}
          <div className="bg-gray-800 rounded-lg shadow-lg p-6 border border-gray-700">
            <h2 className="text-lg font-semibold text-white mb-4">Portfolio Summary</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Total Portfolio Value</label>
                <p className="text-2xl font-bold text-white">
                  ${totalPortfolioValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Total Invested</label>
                <p className="text-2xl font-bold text-white">
                  ${totalOrderValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Total P&L</label>
                <p className={`text-2xl font-bold ${totalProfitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {totalProfitLoss >= 0 ? '+' : ''}${totalProfitLoss.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className={`text-sm ${totalProfitLossPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {totalProfitLossPercent >= 0 ? '+' : ''}{totalProfitLossPercent.toFixed(2)}%
                </p>
              </div>
            </div>
          </div>

          {/* Portfolio Holdings */}
          <div className="bg-gray-800 rounded-lg shadow-lg overflow-hidden border border-gray-700">
            <div className="px-6 py-4 border-b border-gray-700">
              <h2 className="text-lg font-semibold text-white">Holdings</h2>
            </div>
            {portfolioData.length === 0 ? (
              <div className="px-6 py-8 text-center text-gray-400">
                <p>No holdings found</p>
                <p className="text-xs mt-2 text-gray-500">
                  {Object.keys(holdingsData).length === 0 && orders.length === 0
                    ? 'No orders or holdings yet. Place a buy order to get started.'
                    : Object.keys(holdingsData).length === 0
                      ? 'Holdings table is empty. Try syncing holdings or place a new buy order.'
                      : 'Holdings exist but portfolio calculation returned empty. Check console for details.'}
                </p>
              </div>
            ) : (
              <>
                <div className="md:hidden space-y-4 px-4 pb-4">
                  {portfolioData.map((item) => {
                    const totalOrderValue = item.orderValue + (item.lockedOrderValue || 0);
                    const totalCurrentValue = item.currentValue + (item.lockedValue || 0);
                    const totalProfitLoss = totalCurrentValue - totalOrderValue;
                    const totalProfitLossPercent = totalOrderValue > 0 ? (totalProfitLoss / totalOrderValue) * 100 : 0;

                    return (
                      <div key={item.id || item.coin_id} className="bg-gray-700/50 p-4 rounded-xl border border-gray-600">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <h3 className="text-white font-bold text-lg">{item.coin_symbol}</h3>
                            <p className="text-sm text-gray-400">
                              {item.quantity.toLocaleString('en-US', { maximumFractionDigits: 6 })} Avail
                              {item.lockedQuantity > 0 && <span className="text-yellow-500 text-xs ml-1"> +{item.lockedQuantity.toFixed(4)} Lock</span>}
                            </p>
                          </div>
                          <div className="text-right">
                            <div className={`text-lg font-bold ${totalProfitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {totalProfitLoss >= 0 ? '+' : ''}${totalProfitLoss.toFixed(2)}
                            </div>
                            <div className={`text-xs ${totalProfitLossPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {totalProfitLossPercent >= 0 ? '+' : ''}{totalProfitLossPercent.toFixed(2)}%
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs text-gray-400 mb-4 bg-gray-800/50 p-2 rounded">
                          <div>
                            <span className="block text-gray-500">Avg Buy</span>
                            <span className="text-white">${item.orderPrice.toFixed(2)}</span>
                          </div>
                          <div className="text-right">
                            <span className="block text-gray-500">Current</span>
                            <span className="text-white">${item.currentPrice.toFixed(2)}</span>
                          </div>
                        </div>

                        <button
                          onClick={() => {
                            const normalizedCoinId = (item.coin_id || '').toLowerCase().trim();
                            setSelectedCoin({
                              coinId: normalizedCoinId,
                              coinSymbol: item.coin_symbol,
                              currentPrice: item.currentPrice > 0 ? item.currentPrice : 0,
                            });
                            setSellModalOpen(true);
                          }}
                          disabled={item.currentPrice === 0 || item.quantity <= 0}
                          className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg font-bold text-sm"
                        >
                          SELL {item.coin_symbol}
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="hidden md:block overflow-x-auto -mx-4 sm:mx-0">
                  <table className="min-w-full divide-y divide-gray-700">
                    <thead className="bg-gray-700">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Coin</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Quantity (Avail + Lock)</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Order Price</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Current Price</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Order Value</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Current Value</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">P&L</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Action</th>
                      </tr>
                    </thead>
                    <tbody className="bg-gray-800 divide-y divide-gray-700">
                      {portfolioData.map((item) => {
                        // Calculate Totals for Display
                        const totalQuantity = item.quantity + (item.lockedQuantity || 0);
                        const totalOrderValue = item.orderValue + (item.lockedOrderValue || 0);
                        const totalCurrentValue = item.currentValue + (item.lockedValue || 0);

                        const totalProfitLoss = totalCurrentValue - totalOrderValue;
                        const totalProfitLossPercent = totalOrderValue > 0 ? (totalProfitLoss / totalOrderValue) * 100 : 0;

                        return (
                          <tr key={item.id || item.coin_id} className="hover:bg-gray-700 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                              {item.coin_symbol}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                              {item.lockedQuantity > 0 ? (
                                <div className="flex flex-col">
                                  <span>{item.quantity.toLocaleString('en-US', { maximumFractionDigits: 8 })} <span className="text-gray-500 text-xs">(Available)</span></span>
                                  <span className="text-xs text-yellow-500">+{item.lockedQuantity.toLocaleString('en-US', { maximumFractionDigits: 8 })} (Locked)</span>
                                </div>
                              ) : (
                                item.quantity.toLocaleString('en-US', { maximumFractionDigits: 8 })
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                              ${item.orderPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                              {item.currentPrice > 0 ? (
                                `$${item.currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              ) : (
                                <span className="text-gray-500">Loading...</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                              ${totalOrderValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                              {item.currentPrice > 0 ? (
                                `$${totalCurrentValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              ) : (
                                <span className="text-gray-500">Loading...</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              {item.currentPrice > 0 ? (
                                <div className="flex flex-col">
                                  <span className={totalProfitLoss >= 0 ? 'text-green-400' : 'text-red-400'}>
                                    {totalProfitLoss >= 0 ? '+' : ''}${totalProfitLoss.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                  <span className={`text-xs ${totalProfitLossPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {totalProfitLossPercent >= 0 ? '+' : ''}{totalProfitLossPercent.toFixed(2)}%
                                  </span>
                                </div>
                              ) : (
                                <span className="text-gray-500">-</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              <button
                                onClick={() => {
                                  // Ensure coin_id is normalized (lowercase) for consistency
                                  const normalizedCoinId = (item.coin_id || '').toLowerCase().trim();
                                  setSelectedCoin({
                                    coinId: normalizedCoinId, // Use normalized coin_id
                                    coinSymbol: item.coin_symbol,
                                    currentPrice: item.currentPrice > 0 ? item.currentPrice : 0,
                                  });
                                  setSellModalOpen(true);
                                }}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={item.currentPrice === 0 || item.quantity <= 0}
                              >
                                Sell
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Order History Tab */}
      {activeTab === 'orders' && (
        <div className="bg-gray-800 rounded-lg shadow-lg overflow-hidden border border-gray-700">
          <div className="px-6 py-4 border-b border-gray-700">
            <h2 className="text-lg font-semibold text-white">Order History</h2>
          </div>
          <div className="md:hidden space-y-4 px-4 pb-4 pt-2">
            {orders.length === 0 ? (
              <p className="text-center text-gray-400 py-8">No orders yet</p>
            ) : (
              orders.map(order => (
                <div key={order.id} className="bg-gray-700/50 p-4 rounded-xl border border-gray-600">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${order.order_type === 'buy' ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'
                        }`}>
                        {order.order_type}
                      </span>
                      <span className="text-white font-bold">{order.coin_symbol}</span>
                    </div>
                    <div className="text-xs text-gray-400 text-right">
                      <div>{new Date(order.order_date).toLocaleDateString()}</div>
                      <div>{new Date(order.order_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-y-2 text-sm mb-3">
                    <div>
                      <span className="text-gray-500 text-xs block">Quantity</span>
                      <span className="text-white">{order.quantity.toLocaleString()}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-gray-500 text-xs block">Price</span>
                      <span className="text-white">${order.price_per_unit?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || 'Market'}</span>
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-3 border-t border-gray-600/50">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${order.order_status === 'completed' ? 'bg-green-900/30 text-green-400' :
                        order.order_status === 'pending' ? 'bg-yellow-900/30 text-yellow-400' :
                          'bg-red-900/30 text-red-400'
                      }`}>
                      {order.order_status}
                    </span>

                    {order.order_status === 'pending' && (
                      <button
                        onClick={() => cancelOrder(order.id)}
                        className="text-red-400 hover:text-red-300 text-xs font-medium px-3 py-1 bg-red-900/20 rounded hover:bg-red-900/30 transition-colors"
                      >
                        Cancel Order
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="hidden md:block overflow-x-auto -mx-4 sm:mx-0">
            <table className="min-w-full divide-y divide-gray-700">
              <thead className="bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                    Coin
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                    Mode
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                    Quantity
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                    Price
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="bg-gray-800 divide-y divide-gray-700">
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-4 text-center text-gray-400">
                      No orders yet
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => (
                    <tr key={order.id} className="hover:bg-gray-700 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                        {new Date(order.order_date).toLocaleString('en-IN', {
                          timeZone: 'Asia/Kolkata',
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: true
                        })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                        {order.coin_symbol}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                        <span
                          className={`px-2 py-1 rounded ${order.order_type === 'buy'
                            ? 'bg-green-900 text-green-300'
                            : 'bg-red-900 text-red-300'
                            }`}
                        >
                          {order.order_type.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                        {order.order_mode}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                        {order.quantity}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                        <div className="flex flex-col gap-1">
                          <div>
                            {order.price_per_unit
                              ? `$${(parseFloat(order.quantity.toString()) * order.price_per_unit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : 'Market'}
                          </div>
                          {(currentPrices[order.coin_id?.toLowerCase()] || currentPrices[order.coin_id]) && (
                            <div className="text-xs text-gray-400">
                              Current: ${(parseFloat(order.quantity.toString()) * (currentPrices[order.coin_id?.toLowerCase()] || currentPrices[order.coin_id])).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span
                          className={`px-2 py-1 rounded ${order.order_status === 'completed'
                            ? 'bg-green-900 text-green-300'
                            : order.order_status === 'pending'
                              ? 'bg-yellow-900 text-yellow-300'
                              : order.order_status === 'cancelled'
                                ? 'bg-gray-600 text-gray-400'
                                : 'bg-gray-700 text-gray-300'
                            }`}
                        >
                          {order.order_status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {order.order_status === 'pending' && (
                          <button
                            onClick={() => cancelOrder(order.id)}
                            className="text-red-400 hover:text-red-300 text-sm font-medium underline"
                          >
                            Cancel
                          </button>
                        )}
                        {order.order_status === 'cancelled' && (
                          <span className="text-gray-500 text-xs italic">Cancelled</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sell Modal */}
      {selectedCoin && (
        <TradingModal
          isOpen={sellModalOpen}
          onClose={() => {
            setSellModalOpen(false);
            setSelectedCoin(null);
          }}
          coinId={selectedCoin.coinId}
          coinSymbol={selectedCoin.coinSymbol}
          currentPrice={selectedCoin.currentPrice}
          orderType="sell"
          onOrderPlaced={async () => {
            // Close modal first
            setSellModalOpen(false);
            setSelectedCoin(null);

            // Show loading toast
            const loadingToast = toast.loading('Updating portfolio...', { id: 'portfolio-update' });
            // Wait for database to update (especially for market orders)
            await new Promise(resolve => setTimeout(resolve, 3000));
            await refreshAll();
            try {
              const res = await fetch('/api/orders/cleanup-holdings', { method: 'POST' });
              const data = await res.json();
            } catch { }
            await fetchHoldings();

            // Show success message
            toast.success('Order placed successfully! Portfolio updated.', { id: 'portfolio-update' });

            // Log current state for debugging
            console.log('Portfolio: After sell order, final holdingsData:', holdingsData);
          }}
        />
      )}
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    }>
      <OrdersContent />
    </Suspense>
  );
}
