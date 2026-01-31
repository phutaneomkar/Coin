'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '../../lib/supabase/client';
import { usePriceStore } from '../../store/priceStore';
import { toast } from 'react-hot-toast';
import { LoadingSpinner } from '../../components/shared/LoadingSpinner';
import { X, RefreshCw } from 'lucide-react';
import { OrderType, OrderMode } from '../../types';
import { DEFAULT_USER_ID } from '../../lib/auth-utils';
import { formatPrice } from '../../lib/formatPrice';

interface TradingModalProps {
  isOpen: boolean;
  onClose: () => void;
  coinId: string;
  coinSymbol: string;
  currentPrice: number;
  orderType: 'buy' | 'sell';
  onOrderPlaced?: () => void;
}

export function TradingModal({
  isOpen,
  onClose,
  coinId,
  coinSymbol,
  currentPrice,
  orderType: initialOrderType,
  onOrderPlaced,
}: TradingModalProps) {
  const [orderType, setOrderType] = useState<OrderType>(initialOrderType);
  const [orderMode, setOrderMode] = useState<OrderMode>('market');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [userBalance, setUserBalance] = useState<number | null>(null);
  const [userHoldings, setUserHoldings] = useState<number | null>(null);
  const supabase = createClient();
  const { prices } = usePriceStore();

  // Fetch user balance and holdings
  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const userId = DEFAULT_USER_ID;

        // 1. Fetch raw balance
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('balance_inr')
          .eq('id', userId)
          .maybeSingle();

        let rawBalance = parseFloat(profile?.balance_inr?.toString() || '0');

        // 2. Fetch raw holdings for this coin
        const normalizedCoinId = coinId.toLowerCase().trim();
        let rawHoldings = 0;

        // Try exact match first
        let { data: holding } = await supabase
          .from('holdings')
          .select('quantity')
          .eq('user_id', userId)
          .eq('coin_id', normalizedCoinId)
          .maybeSingle();

        if (holding) {
          rawHoldings = parseFloat(holding.quantity.toString());
        } else {
          // Case-insensitive fallback
          const { data: allHoldings } = await supabase
            .from('holdings')
            .select('quantity, coin_id')
            .eq('user_id', userId);

          const match = allHoldings?.find(h => h.coin_id?.toLowerCase() === normalizedCoinId);
          if (match) {
            rawHoldings = parseFloat(match.quantity.toString());
          }
        }

        // 3. Fetch PENDING orders to calculate locked amounts
        const { data: pendingOrders } = await supabase
          .from('orders')
          .select('*')
          .eq('user_id', userId)
          .eq('order_status', 'pending');

        let lockedBalance = 0;
        let lockedHoldings = 0;

        if (pendingOrders) {
          pendingOrders.forEach(order => {
            if (order.order_type === 'buy') {
              // Lock balance for buy orders
              const p = order.price_per_unit || (order.order_mode === 'market' ? currentPrice : 0);
              if (p > 0) {
                const amt = (p * order.quantity) * 1.001; // +0.1% fee
                lockedBalance += amt;
              }
            } else if (order.order_type === 'sell') {
              // Lock holdings for sell orders
              // Check match by coin_id
              if (order.coin_id?.toLowerCase() === normalizedCoinId) {
                lockedHoldings += order.quantity;
              }
            }
          });
        }

        // 4. Update state with AVAILABLE amounts
        setUserBalance(Math.max(0, rawBalance - lockedBalance));
        setUserHoldings(Math.max(0, rawHoldings - lockedHoldings));

      } catch (error) {
        console.error('Error fetching user data:', error);
        setUserBalance(0);
        setUserHoldings(0);
      }
    };

    if (isOpen && coinId) {
      fetchUserData();
    } else {
      setUserBalance(null);
      setUserHoldings(null);
    }
  }, [isOpen, coinId, coinSymbol, supabase, currentPrice]);

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setOrderType(initialOrderType);
      setOrderMode('market');
      setQuantity('');
      setPrice('');
    }
  }, [isOpen, initialOrderType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const userId = DEFAULT_USER_ID;

      const qty = parseFloat(quantity);
      if (isNaN(qty) || qty <= 0) {
        toast.error('Please enter a valid quantity');
        setIsLoading(false);
        return;
      }

      // Validate quantity precision (max 8 decimal places)
      if (quantity.includes('.') && quantity.split('.')[1]?.length > 8) {
        toast.error('Quantity cannot have more than 8 decimal places');
        setIsLoading(false);
        return;
      }

      const orderPrice = orderMode === 'limit' ? parseFloat(price) : currentPrice;
      if (orderMode === 'limit' && (!price || isNaN(orderPrice) || orderPrice <= 0)) {
        toast.error('Please enter a valid limit price');
        setIsLoading(false);
        return;
      }

      // Validate price precision (max 8 decimal places)
      if (orderMode === 'limit' && price.includes('.') && price.split('.')[1]?.length > 8) {
        toast.error('Price cannot have more than 8 decimal places');
        setIsLoading(false);
        return;
      }

      // Calculate total amount with trading fee
      const TAX_RATE = 0.001; // 0.1% trading fee
      const baseAmount = qty * orderPrice;
      const tradingFee = baseAmount * TAX_RATE;
      const totalAmount = baseAmount + tradingFee;

      // Check balance for buy orders (including fee)
      if (orderType === 'buy') {
        const { data: profile } = await supabase
          .from('profiles')
          .select('balance_inr')
          .eq('id', userId)
          .maybeSingle();

        if (!profile) {
          toast.error('User profile not found');
          return;
        }

        if (profile.balance_inr < totalAmount) {
          toast.error(`Insufficient balance. Required: $${totalAmount.toFixed(2)}, Available: $${profile.balance_inr.toFixed(2)}`);
          return;
        }
      }

      // Check holdings for sell orders - with case-insensitive matching
      if (orderType === 'sell') {
        const normalizedCoinId = coinId.toLowerCase().trim();

        // First try with normalized coin_id
        let { data: holding, error: holdingError } = await supabase
          .from('holdings')
          .select('quantity, coin_id')
          .eq('user_id', userId)
          .eq('coin_id', normalizedCoinId)
          .maybeSingle();

        // If not found, try case-insensitive search
        if (!holding && !holdingError) {
          const { data: allHoldings } = await supabase
            .from('holdings')
            .select('quantity, coin_id')
            .eq('user_id', userId);

          if (allHoldings) {
            holding = allHoldings.find(
              h => h.coin_id?.toLowerCase() === normalizedCoinId
            ) ?? null;
          }
        }

        if (holdingError) {
          console.error('Error checking holdings:', holdingError);
        }

        const availableQty = holding ? parseFloat(holding.quantity.toString()) : 0;

        if (!holding || availableQty < qty) {
          toast.error(`Insufficient holdings. Required: ${qty}, Available: ${availableQty}`);
          setIsLoading(false);
          return;
        }
      }

      // Place order via API route
      const response = await fetch('/api/orders/place', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coin_id: coinId.toLowerCase().trim(), // Normalize to lowercase for consistency
          coin_symbol: coinSymbol,
          side: orderType,
          order_type: orderMode === 'market' ? 'market_order' : 'limit_order',
          quantity: qty,
          price: orderMode === 'limit' ? orderPrice : undefined,
          current_price: currentPrice,
          market: `${coinSymbol}USD`,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        const errorMessage = result.details
          ? `${result.error}: ${result.details}`
          : result.error || 'Failed to place order';
        throw new Error(errorMessage);
      }

      if (orderMode === 'market') {
        toast.success(`${orderType === 'buy' ? 'Buy' : 'Sell'} order executed successfully!`);
      } else {
        toast.success(`Limit order placed successfully!`);
      }
      setQuantity('');
      setPrice('');

      // Refresh user data after order placement
      // Refresh balance
      const { data: profile } = await supabase
        .from('profiles')
        .select('balance_inr')
        .eq('id', userId)
        .maybeSingle();
      if (profile) {
        setUserBalance(parseFloat(profile.balance_inr?.toString() || '0'));
      }

      // Refresh holdings (sync will happen automatically on orders page)
      // Don't call sync here to avoid loops
      const normalizedCoinId = coinId.toLowerCase().trim();
      let { data: holding } = await supabase
        .from('holdings')
        .select('quantity, coin_id')
        .eq('user_id', userId)
        .eq('coin_id', normalizedCoinId)
        .maybeSingle();

      // If not found, try case-insensitive search
      if (!holding) {
        const { data: allHoldings } = await supabase
          .from('holdings')
          .select('quantity, coin_id')
          .eq('user_id', userId);

        if (allHoldings) {
          holding = allHoldings.find(
            (h: { quantity: any; coin_id: any }) => h.coin_id?.toLowerCase() === normalizedCoinId
          ) ?? null;
        }
      }

      if (holding && holding.quantity) {
        const qty = parseFloat(holding.quantity.toString());
        setUserHoldings(qty);
        console.log('TradingModal: Refreshed holdings after order', { qty, holding });
      } else {
        setUserHoldings(0);
        console.log('TradingModal: No holdings found after order refresh');

        // If it's a buy order, try syncing holdings
        if (orderType === 'buy' && orderMode === 'market') {
          console.log('TradingModal: Attempting to sync holdings after buy order');
          try {
            const syncResponse = await fetch('/api/orders/sync-holdings', { method: 'POST' });
            const syncData = await syncResponse.json();
            if (syncData.success) {
              console.log('TradingModal: Sync successful', syncData);
              // Wait a bit then refresh again
              await new Promise(resolve => setTimeout(resolve, 500));

              // Re-fetch holdings
              const refreshedNormalizedCoinId = coinId.toLowerCase().trim();
              const { data: refreshedHolding } = await supabase
                .from('holdings')
                .select('quantity, coin_id')
                .eq('user_id', userId)
                .eq('coin_id', refreshedNormalizedCoinId)
                .maybeSingle();

              if (refreshedHolding && refreshedHolding.quantity) {
                const qty = parseFloat(refreshedHolding.quantity.toString());
                setUserHoldings(qty);
                console.log('TradingModal: Found holdings after sync', { qty });
              }
            }
          } catch (syncError) {
            console.error('TradingModal: Sync error', syncError);
          }
        }
      }

      // Wait a bit for database to update (especially for market orders)
      if (orderMode === 'market') {
        await new Promise(resolve => setTimeout(resolve, 800));
      }

      onOrderPlaced?.();
      onClose();
    } catch (error) {
      console.error('Error placing order:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to place order');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  // Tax/fee rate (0.1% = 0.001)
  const TAX_RATE = 0.001; // 0.1% trading fee

  const baseAmount = quantity && currentPrice > 0
    ? parseFloat(quantity) * (orderMode === 'limit' && price ? parseFloat(price) : currentPrice)
    : 0;

  const taxAmount = baseAmount * TAX_RATE;
  const estimatedTotal = baseAmount + taxAmount;

  // Calculate available amount based on order type
  const getAvailableAmount = () => {
    if (orderType === 'buy') {
      return userBalance || 0;
    } else {
      return userHoldings || 0;
    }
  };



  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 w-full max-w-md mx-4 shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white">Trade {coinSymbol}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                try {
                  // Just refresh user data without syncing (sync should be done manually on orders page)
                  const userId = DEFAULT_USER_ID;
                  const { data: profile } = await supabase
                    .from('profiles')
                    .select('balance_inr')
                    .eq('id', userId)
                    .maybeSingle();
                  if (profile) {
                    setUserBalance(parseFloat(profile.balance_inr?.toString() || '0'));
                  }

                  const normalizedCoinId = coinId.toLowerCase().trim();
                  let { data: holding } = await supabase
                    .from('holdings')
                    .select('quantity, coin_id')
                    .eq('user_id', userId)
                    .eq('coin_id', normalizedCoinId)
                    .maybeSingle();

                  // If not found, try case-insensitive search
                  if (!holding) {
                    const { data: allHoldings } = await supabase
                      .from('holdings')
                      .select('quantity, coin_id')
                      .eq('user_id', userId);
                    if (allHoldings) {
                      holding = allHoldings.find(
                        (h: { quantity: any; coin_id: any }) => h.coin_id?.toLowerCase() === normalizedCoinId
                      ) ?? null;
                    }
                  }

                  if (holding && holding.quantity) {
                    const qty = parseFloat(holding.quantity.toString());
                    setUserHoldings(qty);
                    toast.success(`Holdings refreshed: ${qty} ${coinSymbol}`);
                  } else {
                    setUserHoldings(0);
                    toast.success('Holdings refreshed');
                  }
                } catch (error) {
                  console.error('Error refreshing holdings:', error);
                  toast.error('Failed to refresh holdings');
                }
              }}
              className="text-gray-400 hover:text-white transition-colors p-1"
              title="Sync and refresh holdings"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Order Type - CoinDCX Style Large Buttons */}
          <div>
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setOrderType('buy')}
                className={`flex-1 py-3 px-4 rounded-lg font-semibold text-lg transition-all ${orderType === 'buy'
                  ? 'bg-green-600 text-white shadow-lg shadow-green-600/30'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
              >
                BUY
              </button>
              <button
                type="button"
                onClick={() => setOrderType('sell')}
                className={`flex-1 py-3 px-4 rounded-lg font-semibold text-lg transition-all ${orderType === 'sell'
                  ? 'bg-red-600 text-white shadow-lg shadow-red-600/30'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
              >
                SELL
              </button>
            </div>

            {/* Available Balance/Holdings Display - CoinDCX Style */}
            <div className={`p-4 rounded-lg mb-4 border-2 ${orderType === 'buy'
              ? 'bg-green-900/20 border-green-700/50'
              : 'bg-red-900/20 border-red-700/50'
              }`}>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-400">
                  {orderType === 'buy' ? 'Available Balance' : 'Available Holdings'}
                </span>
                <span className={`text-xl font-bold ${orderType === 'buy' ? 'text-green-400' : 'text-red-400'
                  }`}>
                  {orderType === 'buy'
                    ? userBalance !== null
                      ? `$${(userBalance || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : 'Loading...'
                    : userHoldings !== null
                      ? `${(userHoldings || 0).toLocaleString('en-US', { maximumFractionDigits: 8 })} ${coinSymbol}`
                      : 'Loading...'
                  }
                </span>
              </div>
              {orderType === 'sell' && userHoldings !== null && userHoldings === 0 && (
                <p className="mt-2 text-xs text-yellow-400">
                  ⚠️ You don't have any {coinSymbol} holdings to sell
                </p>
              )}
            </div>
          </div>

          {/* Current Price Display - CoinDCX Style */}
          {currentPrice > 0 && (
            <div className="bg-gray-700 p-4 rounded-lg border border-gray-600">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-400">Current Price</span>
                <span className="text-xl font-bold text-white">{formatPrice(currentPrice)}</span>
              </div>
            </div>
          )}

          {/* Order Mode - CoinDCX Style Tabs */}
          <div>
            <div className="flex gap-2 bg-gray-700 p-1 rounded-lg">
              <button
                type="button"
                onClick={() => setOrderMode('market')}
                className={`flex-1 py-2 px-4 rounded-md font-medium transition-all ${orderMode === 'market'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-gray-400 hover:text-white'
                  }`}
              >
                Market
              </button>
              <button
                type="button"
                onClick={() => setOrderMode('limit')}
                className={`flex-1 py-2 px-4 rounded-md font-medium transition-all ${orderMode === 'limit'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-gray-400 hover:text-white'
                  }`}
              >
                Limit
              </button>
            </div>
            {orderMode === 'market' && (
              <p className="mt-2 text-xs text-gray-400 text-center">
                Order will execute immediately at current market price
              </p>
            )}
          </div>

          {/* Quantity - CoinDCX Style */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-300">
                Quantity ({coinSymbol})
              </label>
              {orderType === 'sell' && userHoldings !== null && (
                <span className="text-xs text-gray-400">
                  Available: {userHoldings.toLocaleString('en-US', { maximumFractionDigits: 8 })}
                </span>
              )}
            </div>
            <input
              type="text"
              value={quantity}
              onChange={(e) => {
                const value = e.target.value;
                // Allow only numbers and decimal point
                if (value === '' || /^\d*\.?\d*$/.test(value)) {
                  setQuantity(value);
                }
              }}
              required
              className="w-full px-4 py-3 bg-gray-700 border-2 border-gray-600 text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400 text-lg font-medium"
              placeholder="0.00"
            />

            {orderType === 'sell' && userHoldings !== null && quantity && parseFloat(quantity) > userHoldings && (
              <p className="mt-2 text-xs text-red-400 flex items-center gap-1">
                <span>⚠️</span> Quantity exceeds available holdings
              </p>
            )}
          </div>

          {/* Limit Price (for Limit orders) - CoinDCX Style */}
          {orderMode === 'limit' && (
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium text-gray-300">
                  Limit Price (USD)
                </label>
                {currentPrice > 0 && (
                  <button
                    type="button"
                    onClick={() => setPrice(currentPrice.toFixed(2))}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    Use Market Price
                  </button>
                )}
              </div>
              <input
                type="text"
                value={price}
                onChange={(e) => {
                  const value = e.target.value;
                  // Allow only numbers and decimal point
                  if (value === '' || /^\d*\.?\d*$/.test(value)) {
                    setPrice(value);
                  }
                }}
                required
                className="w-full px-4 py-3 bg-gray-700 border-2 border-gray-600 text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400 text-lg font-medium"
                placeholder="0.00"
              />
              {currentPrice > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-gray-400">
                    Current Market Price: {formatPrice(currentPrice)}
                  </p>
                  {price && parseFloat(price) > 0 && (
                    <>
                      <p className={`text-xs ${parseFloat(price) > currentPrice
                        ? 'text-green-400'
                        : parseFloat(price) < currentPrice
                          ? 'text-red-400'
                          : 'text-gray-400'
                        }`}>
                        {parseFloat(price) > currentPrice
                          ? `Above market by ${formatPrice(parseFloat(price) - currentPrice)}`
                          : parseFloat(price) < currentPrice
                            ? `Below market by ${formatPrice(currentPrice - parseFloat(price))}`
                            : 'At market price'}
                      </p>
                      <p className="text-xs text-blue-400 mt-1">
                        {orderType === 'buy'
                          ? `Buy order will execute when price drops to ${formatPrice(parseFloat(price))} or below`
                          : `Sell order will execute when price rises to ${formatPrice(parseFloat(price))} or above`}
                      </p>
                      {orderType === 'buy' && parseFloat(price) >= currentPrice && (
                        <p className="text-xs text-yellow-400 mt-1">
                          ⚠️ Limit price is above current market price. Order will execute when price drops.
                        </p>
                      )}
                      {orderType === 'sell' && parseFloat(price) <= currentPrice && (
                        <p className="text-xs text-yellow-400 mt-1">
                          ⚠️ Limit price is below current market price. Order will execute when price rises.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Estimated Total with Tax - CoinDCX Style */}
          {quantity && parseFloat(quantity) > 0 && currentPrice > 0 && (
            <div className={`p-4 rounded-lg border-2 space-y-3 ${orderType === 'buy'
              ? 'bg-green-900/10 border-green-700/50'
              : 'bg-red-900/10 border-red-700/50'
              }`}>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">
                  {orderType === 'buy' ? 'You Pay' : 'You Receive'}
                </span>
                <span className={`font-semibold text-lg ${orderType === 'buy' ? 'text-green-400' : 'text-red-400'
                  }`}>
                  {orderType === 'buy'
                    ? formatPrice(estimatedTotal)
                    : formatPrice(baseAmount - taxAmount)
                  }
                </span>
              </div>
              <div className="flex justify-between text-xs text-gray-500 pt-2 border-t border-gray-700">
                <span>Subtotal:</span>
                <span>{formatPrice(baseAmount)}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>Trading Fee (0.1%):</span>
                <span>{formatPrice(taxAmount)}</span>
              </div>
            </div>
          )}

          {/* Submit Button - CoinDCX Style */}
          <button
            type="submit"
            disabled={isLoading || !quantity || parseFloat(quantity) <= 0 || (orderMode === 'limit' && (!price || parseFloat(price) <= 0))}
            className={`w-full py-4 px-4 rounded-lg font-bold text-lg text-white shadow-lg transition-all ${orderType === 'buy'
              ? 'bg-green-600 hover:bg-green-700 shadow-green-600/30'
              : 'bg-red-600 hover:bg-red-700 shadow-red-600/30'
              } disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none flex items-center justify-center gap-2`}
          >
            {isLoading ? (
              <>
                <LoadingSpinner size="sm" />
                <span>Processing...</span>
              </>
            ) : (
              `${orderType === 'buy' ? 'BUY' : 'SELL'} ${coinSymbol}`
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
