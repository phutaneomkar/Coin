'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { usePriceStore } from '@/store/priceStore';
import { toast } from 'react-hot-toast';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { OrderType, OrderMode } from '@/types';

interface OrderFormProps {
  onOrderPlaced: () => void;
}

export function OrderForm({ onOrderPlaced }: OrderFormProps) {
  const searchParams = useSearchParams();
  const [coinId, setCoinId] = useState('bitcoin');
  const [orderType, setOrderType] = useState<OrderType>('buy');
  const [orderMode, setOrderMode] = useState<OrderMode>('market');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [userBalance, setUserBalance] = useState<number | null>(null);
  const [userHoldings, setUserHoldings] = useState<number | null>(null);
  const supabase = createClient();
  const { prices } = usePriceStore();
  const currentPrice = prices[coinId]?.current_price || 0;

  // Read URL params to pre-fill form
  useEffect(() => {
    const action = searchParams?.get('action');
    const coinIdParam = searchParams?.get('coinId');
    const coinSymbolParam = searchParams?.get('coinSymbol');

    if (action === 'buy' || action === 'sell') {
      setOrderType(action);
    }
    if (coinIdParam) {
      setCoinId(coinIdParam);
    }
  }, [searchParams]);

  // Fetch user balance and holdings, accounting for locked funds/assets
  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) return;

        // Fetch profile (balance)
        const { data: profile } = await supabase
          .from('profiles')
          .select('balance_inr')
          .eq('id', user.id)
          .single();

        let rawBalance = profile?.balance_inr || 0;

        // Fetch holdings for this coin
        const { data: holding } = await supabase
          .from('holdings')
          .select('quantity')
          .eq('user_id', user.id)
          .eq('coin_id', coinId)
          .single();

        let rawHoldings = holding?.quantity || 0;

        // Fetch PENDING orders to calculate locked amounts
        const { data: pendingOrders } = await supabase
          .from('orders')
          .select('*')
          .eq('user_id', user.id)
          .eq('order_status', 'pending');

        let lockedBalance = 0;
        let lockedHoldings = 0;

        if (pendingOrders) {
          pendingOrders.forEach(order => {
            if (order.order_type === 'buy') {
              // Lock balance for buy orders
              // For limit orders: price * quantity
              // For market orders (if any pending): estimated total
              const p = order.price_per_unit || currentPrice;
              const amt = (p * order.quantity) * 1.001; // Include 0.1% fee
              lockedBalance += amt;
            } else if (order.order_type === 'sell') {
              // Lock holdings for sell orders
              // Only if it matches the current coin
              if (order.coin_id === coinId) {
                lockedHoldings += order.quantity;
              }
            }
          });
        }

        // Update state with AVAILABLE amounts
        setUserBalance(Math.max(0, rawBalance - lockedBalance));
        setUserHoldings(Math.max(0, rawHoldings - lockedHoldings));

      } catch (error) {
        console.error('Error fetching user data:', error);
      }
    };

    if (coinId) {
      fetchUserData();
    }
  }, [coinId, supabase, currentPrice]);


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        toast.error('Please login to place orders');
        return;
      }

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
          .eq('id', user.id)
          .single();

        if (!profile) {
          toast.error('User profile not found');
          return;
        }

        if (profile.balance_inr < totalAmount) {
          toast.error(`Insufficient balance. Required: $${totalAmount.toFixed(2)}, Available: $${profile.balance_inr.toFixed(2)}`);
          return;
        }
      }

      // Check holdings for sell orders
      if (orderType === 'sell') {
        const { data: holding } = await supabase
          .from('holdings')
          .select('quantity')
          .eq('user_id', user.id)
          .eq('coin_id', coinId)
          .single();

        if (!holding || holding.quantity < qty) {
          const available = holding?.quantity || 0;
          toast.error(`Insufficient holdings. Required: ${qty}, Available: ${available}`);
          return;
        }
      }

      const coinSymbol = prices[coinId]?.symbol || coinId.toUpperCase();

      // Place order via API route
      const response = await fetch('/api/orders/place', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coin_id: coinId,
          coin_symbol: coinSymbol,
          side: orderType,
          order_type: orderMode === 'market' ? 'market_order' : 'limit_order',
          quantity: qty,
          price: orderMode === 'limit' ? orderPrice : undefined,
          current_price: currentPrice, // Include current price for market orders
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
      onOrderPlaced();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to place order');
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate available amount based on order type
  const getAvailableAmount = () => {
    if (orderType === 'buy') {
      return userBalance || 0;
    } else {
      return userHoldings || 0;
    }
  };

  // Quick percentage buttons (25%, 50%, 75%, 100%)
  const handlePercentageClick = (percentage: number) => {
    const available = getAvailableAmount();
    const priceToUse = orderMode === 'limit' && price ? parseFloat(price) : currentPrice;

    if (priceToUse <= 0) return;

    if (orderType === 'buy') {
      // For buy: calculate quantity based on available balance
      // quantity = (balance * percentage) / price
      const maxQuantity = (available / priceToUse) * (percentage / 100);
      setQuantity(maxQuantity.toFixed(8).replace(/\.?0+$/, ''));
    } else if (orderType === 'sell') {
      // For sell: use available holdings directly
      const sellQuantity = available * (percentage / 100);
      setQuantity(sellQuantity.toFixed(8).replace(/\.?0+$/, ''));
    }
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(price);
  };

  const popularCoins = Object.values(prices).slice(0, 10);

  // Calculate estimated totals
  const TAX_RATE = 0.001; // 0.1% trading fee
  const priceVal = orderMode === 'limit' && price ? parseFloat(price) : currentPrice;
  const quantityVal = parseFloat(quantity) || 0;
  const baseAmount = quantityVal * priceVal;
  const taxAmount = baseAmount * TAX_RATE;
  const estimatedTotal = baseAmount + taxAmount;

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg p-6 border border-gray-700">
      <h2 className="text-xl font-semibold text-white mb-6">Place Order</h2>
      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Order Type & Balance Header */}
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

          {/* Available Balance/Holdings Display */}
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
                    ? `${(userHoldings || 0).toLocaleString('en-US', { maximumFractionDigits: 8 })}`
                    : 'Loading...'
                }
              </span>
            </div>
          </div>
        </div>

        {/* Cryptocurrency Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Cryptocurrency
          </label>
          <select
            value={coinId}
            onChange={(e) => setCoinId(e.target.value)}
            className="w-full px-4 py-3 bg-gray-700 border border-gray-600 text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg"
          >
            {popularCoins.map((coin) => (
              <option key={coin.id} value={coin.id} className="bg-gray-700">
                {coin.name} ({coin.symbol})
              </option>
            ))}
          </select>
          {currentPrice > 0 && (
            <div className="mt-2 flex justify-between items-center bg-gray-700/50 p-3 rounded-lg border border-gray-600">
              <span className="text-sm text-gray-400">Current Market Price</span>
              <span className="text-lg font-bold text-white">
                ${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
        </div>

        {/* Order Mode Tabs */}
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
        </div>

        {/* Quantity Input */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Quantity
          </label>
          <input
            type="text"
            value={quantity}
            onChange={(e) => {
              const value = e.target.value;
              if (value === '' || /^\d*\.?\d*$/.test(value)) {
                setQuantity(value);
              }
            }}
            required
            className="w-full px-4 py-3 bg-gray-700 border-2 border-gray-600 text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400 text-lg font-medium"
            placeholder="0.00"
          />

          {/* Percentage Buttons */}
          <div className="flex gap-2 mt-2">
            {[25, 50, 75, 100].map((percent) => (
              <button
                key={percent}
                type="button"
                onClick={() => handlePercentageClick(percent)}
                className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors ${orderType === 'buy'
                  ? 'bg-green-900/30 text-green-400 hover:bg-green-900/50 border border-green-700/50'
                  : 'bg-red-900/30 text-red-400 hover:bg-red-900/50 border border-red-700/50'
                  }`}
              >
                {percent}%
              </button>
            ))}
          </div>
        </div>

        {/* Limit Price Input */}
        {orderMode === 'limit' && (
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-300">
                Limit Price ($)
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
                if (value === '' || /^\d*\.?\d*$/.test(value)) {
                  setPrice(value);
                }
              }}
              required
              className="w-full px-4 py-3 bg-gray-700 border-2 border-gray-600 text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400 text-lg font-medium"
              placeholder="0.00"
            />
            {price && parseFloat(price) > 0 && currentPrice > 0 && (
              <p className={`text-xs mt-1 ${parseFloat(price) > currentPrice
                ? 'text-green-400'
                : parseFloat(price) < currentPrice
                  ? 'text-red-400'
                  : 'text-gray-400'
                }`}>
                {Math.abs((parseFloat(price) - currentPrice) / currentPrice * 100).toFixed(2)}% {parseFloat(price) > currentPrice ? 'above' : 'below'} market
              </p>
            )}
          </div>
        )}

        {/* Estimated Total */}
        {quantityVal > 0 && priceVal > 0 && (
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

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isLoading || quantityVal <= 0 || (orderMode === 'limit' && (!price || parseFloat(price) <= 0))}
          className={`w-full py-4 px-4 rounded-lg font-bold text-lg text-white shadow-lg transition-all ${orderType === 'buy'
            ? 'bg-green-600 hover:bg-green-700 shadow-green-600/30'
            : 'bg-red-600 hover:bg-red-700 shadow-red-600/30'
            } disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none flex items-center justify-center`}
        >
          {isLoading ? <LoadingSpinner size="sm" /> : `Place ${orderType.toUpperCase()} Order`}
        </button>
      </form>
    </div>
  );
}

