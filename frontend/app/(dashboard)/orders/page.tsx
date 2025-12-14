'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Order } from '@/types';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { OrderForm } from '@/components/orders/OrderForm';
import { usePriceStore } from '@/store/priceStore';
import { TradingModal } from '@/components/coins/TradingModal';

function OrdersContent() {
  const searchParams = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<'orders' | 'portfolio'>('orders');
  const [sellModalOpen, setSellModalOpen] = useState(false);
  const [selectedCoin, setSelectedCoin] = useState<{ coinId: string; coinSymbol: string; currentPrice: number } | null>(null);
  const [holdingsData, setHoldingsData] = useState<Record<string, { quantity: number; average_buy_price: number }>>({});
  const supabase = createClient();
  const { prices } = usePriceStore();
  
  // Check if we have action param (from buy/sell buttons)
  const hasActionParam = searchParams?.get('action') !== null;

  useEffect(() => {
    fetchOrders();
    fetchHoldings();
    
    // Check and execute limit orders every 10 seconds
    const checkLimitOrders = async () => {
      try {
        await fetch('/api/orders/check-limits', { method: 'GET' });
        // Refresh orders and holdings after checking
        fetchOrders();
        fetchHoldings();
      } catch (error) {
        console.error('Error checking limit orders:', error);
      }
    };

    // Initial check
    checkLimitOrders();

    // Set up interval to check every 10 seconds
    const interval = setInterval(checkLimitOrders, 10000);

    return () => clearInterval(interval);
  }, []);

  // Fetch holdings from holdings table (aggregated)
  const fetchHoldings = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      const { data: holdings, error } = await supabase
        .from('holdings')
        .select('coin_id, quantity, average_buy_price')
        .eq('user_id', user.id)
        .gt('quantity', 0);

      if (error) {
        console.error('Error fetching holdings:', error);
        return;
      }

      // Create a map of coin_id -> holdings data
      const holdingsMap: Record<string, { quantity: number; average_buy_price: number }> = {};
      if (holdings) {
        holdings.forEach(holding => {
          const coinId = holding.coin_id?.toLowerCase() || '';
          if (coinId) {
            holdingsMap[coinId] = {
              quantity: parseFloat(holding.quantity.toString()),
              average_buy_price: parseFloat(holding.average_buy_price.toString()),
            };
          }
        });
      }
      setHoldingsData(holdingsMap);
    } catch (error) {
      console.error('Error fetching holdings:', error);
    }
  };

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

  const fetchOrders = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', user.id)
        .order('order_date', { ascending: false });

      if (error) {
        // Check if it's a 404 (table doesn't exist)
        if (error.code === 'PGRST116' || error.message.includes('relation') || error.message.includes('does not exist')) {
          console.error('Database tables not found. Please run the schema.sql in Supabase SQL Editor.');
          console.error('See SETUP_DATABASE.md for instructions.');
          return;
        }
        throw error;
      }

      // Auto-complete pending market orders (they should execute immediately)
      const pendingMarketOrders = (data || []).filter(
        order => order.order_status === 'pending' && order.order_mode === 'market'
      );

      if (pendingMarketOrders.length > 0) {
        const orderIds = pendingMarketOrders.map(order => order.id);
        await supabase
          .from('orders')
          .update({ order_status: 'completed' })
          .in('id', orderIds);
        
        // Refresh orders after update
        const { data: updatedData } = await supabase
          .from('orders')
          .select('*')
          .eq('user_id', user.id)
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
  };

  // Calculate portfolio data - use holdings table for accurate quantities (aggregated)
  // Group by coin_id and use holdings table data when available
  const portfolioData = useMemo(() => {
    const portfolioDataMap = new Map<string, any>();
    
    // First, add holdings from holdings table (most accurate)
    Object.entries(holdingsData).forEach(([coinId, holding]) => {
      // Try both lowercase and original case for price lookup
      const normalizedCoinId = coinId.toLowerCase();
      const currentPrice = currentPrices[normalizedCoinId] || currentPrices[coinId] || 0;
      const orderPrice = holding.average_buy_price;
      const orderValue = holding.quantity * orderPrice;
      const currentValue = holding.quantity * currentPrice;
      const profitLoss = currentValue - orderValue;
      const profitLossPercent = orderValue > 0 ? (profitLoss / orderValue) * 100 : 0;

      // Find matching order for coin_symbol (try case-insensitive)
      const matchingOrder = orders.find(
        o => o.order_status === 'completed' && 
        o.order_type === 'buy' && 
        (o.coin_id?.toLowerCase() === normalizedCoinId || o.coin_id === coinId)
      );

      portfolioDataMap.set(normalizedCoinId, {
        id: matchingOrder?.id || coinId,
        coin_id: normalizedCoinId, // Use normalized for consistency
        coin_symbol: matchingOrder?.coin_symbol || coinId.toUpperCase(),
        quantity: holding.quantity,
        orderPrice,
        orderValue,
        currentPrice,
        currentValue,
        profitLoss,
        profitLossPercent,
      });
    });

    // Convert map to array
    return Array.from(portfolioDataMap.values());
  }, [holdingsData, currentPrices, orders]);

  const totalPortfolioValue = portfolioData.reduce((sum, item) => sum + item.currentValue, 0);
  const totalOrderValue = portfolioData.reduce((sum, item) => sum + item.orderValue, 0);
  const totalProfitLoss = totalPortfolioValue - totalOrderValue;
  const totalProfitLossPercent = totalOrderValue > 0 ? (totalProfitLoss / totalOrderValue) * 100 : 0;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-white">Orders</h1>
      </div>

      {/* Order Form - Only show if URL has action param (from buy/sell buttons) */}
      {hasActionParam && (
        <div className="mb-6">
          <OrderForm onOrderPlaced={fetchOrders} />
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 border-b border-gray-700">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('orders')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'orders'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            Order History
          </button>
          <button
            onClick={() => setActiveTab('portfolio')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'portfolio'
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
                No completed buy orders yet
              </div>
            ) : (
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="min-w-full divide-y divide-gray-700">
                  <thead className="bg-gray-700">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Coin</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Quantity</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Order Price</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Current Price</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Order Value</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Current Value</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">P&L</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody className="bg-gray-800 divide-y divide-gray-700">
                    {portfolioData.map((item) => (
                      <tr key={item.id || item.coin_id} className="hover:bg-gray-700 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                          {item.coin_symbol}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                          {item.quantity.toLocaleString('en-US', { maximumFractionDigits: 8 })}
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
                          ${item.orderValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                          {item.currentPrice > 0 ? (
                            `$${item.currentValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          ) : (
                            <span className="text-gray-500">Loading...</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {item.currentPrice > 0 ? (
                            <div className="flex flex-col">
                              <span className={item.profitLoss >= 0 ? 'text-green-400' : 'text-red-400'}>
                                {item.profitLoss >= 0 ? '+' : ''}${item.profitLoss.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                              <span className={`text-xs ${item.profitLossPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {item.profitLossPercent >= 0 ? '+' : ''}{item.profitLossPercent.toFixed(2)}%
                              </span>
                            </div>
                          ) : (
                            <span className="text-gray-500">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <button
                            onClick={() => {
                              setSelectedCoin({
                                coinId: item.coin_id,
                                coinSymbol: item.coin_symbol,
                                currentPrice: item.currentPrice > 0 ? item.currentPrice : 0,
                              });
                              setSellModalOpen(true);
                            }}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium transition-colors"
                            disabled={item.currentPrice === 0}
                          >
                            Sell
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="min-w-full divide-y divide-gray-700">
            <thead className="bg-gray-700">
                  <tr>
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
                  </tr>
                </thead>
            <tbody className="bg-gray-800 divide-y divide-gray-700">
                  {orders.length === 0 ? (
                    <tr>
                  <td colSpan={6} className="px-6 py-4 text-center text-gray-400">
                        No orders yet
                      </td>
                    </tr>
                  ) : (
                    orders.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-700 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                          {order.coin_symbol}
                        </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                          <span
                            className={`px-2 py-1 rounded ${
                              order.order_type === 'buy'
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
                            ? `$${order.price_per_unit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : 'Market'}
                        </div>
                        {order.order_status === 'pending' && currentPrices[order.coin_id] && (
                          <div className="text-xs text-gray-400">
                            Current: ${currentPrices[order.coin_id].toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        )}
                      </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span
                            className={`px-2 py-1 rounded ${
                              order.order_status === 'completed'
                            ? 'bg-green-900 text-green-300'
                                : order.order_status === 'pending'
                            ? 'bg-yellow-900 text-yellow-300'
                            : 'bg-gray-700 text-gray-300'
                            }`}
                          >
                            {order.order_status}
                          </span>
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
          onOrderPlaced={() => {
            fetchOrders();
            fetchHoldings(); // Refresh holdings after sell
            setSellModalOpen(false);
            setSelectedCoin(null);
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
