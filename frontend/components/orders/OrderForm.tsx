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

  // Fetch user balance and holdings
  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) return;

        // Fetch balance
        const { data: profile } = await supabase
          .from('profiles')
          .select('balance_inr')
          .eq('id', user.id)
          .single();

        if (profile) {
          setUserBalance(profile.balance_inr);
        }

        // Fetch holdings for this coin
        const { data: holding } = await supabase
          .from('holdings')
          .select('quantity')
          .eq('user_id', user.id)
          .eq('coin_id', coinId)
          .single();

        if (holding) {
          setUserHoldings(holding.quantity);
        }
      } catch (error) {
        // Silently fail - user data not critical for form
      }
    };

    if (coinId) {
      fetchUserData();
    }
  }, [coinId, supabase]);

  const currentPrice = prices[coinId]?.current_price || 0;

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

  const popularCoins = Object.values(prices).slice(0, 10);

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg p-6 border border-gray-700">
      <h2 className="text-xl font-semibold text-white mb-6">Place Order</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Order Type
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOrderType('buy')}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                orderType === 'buy'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Buy
            </button>
            <button
              type="button"
              onClick={() => setOrderType('sell')}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                orderType === 'sell'
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Sell
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Cryptocurrency
          </label>
          <select
            value={coinId}
            onChange={(e) => setCoinId(e.target.value)}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {popularCoins.map((coin) => (
              <option key={coin.id} value={coin.id} className="bg-gray-700">
                {coin.name} ({coin.symbol})
              </option>
            ))}
          </select>
          {currentPrice > 0 && (
            <p className="mt-1 text-sm text-white">
              Current Price: ${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Order Mode
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOrderMode('market')}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                orderMode === 'market'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Market
            </button>
            <button
              type="button"
              onClick={() => setOrderMode('limit')}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                orderMode === 'limit'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Limit
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Quantity
          </label>
          <input
            type="text"
            value={quantity}
            onChange={(e) => {
              const value = e.target.value;
              // Allow only numbers and decimal point
              if (value === '' || /^\d*\.?\d*$/.test(value)) {
                setQuantity(value);
                // Don't auto-fill price - let user set it manually for limit orders
              }
            }}
            required
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400"
            placeholder="0.00"
          />
          {orderMode === 'limit' && !price && currentPrice > 0 && (
            <p className="mt-1 text-xs text-gray-400">
              Tip: Enter limit price to set your desired execution price
            </p>
          )}
        </div>

        {orderMode === 'limit' && (
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Limit Price ($)
            </label>
              <input
                type="text"
                value={price}
                onChange={(e) => {
                  const value = e.target.value;
                  // Allow only numbers and decimal point
                  if (value === '' || /^\d*\.?\d*$/.test(value)) {
                    setPrice(value);
                    // Don't auto-calculate quantity when price changes
                    // Let user enter quantity manually
                  }
                }}
                required
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400"
                placeholder="0.00"
              />
            {currentPrice > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-xs text-gray-400">
                  Current Market Price: ${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                {price && parseFloat(price) > 0 && (
                  <>
                    <p className={`text-xs ${
                      parseFloat(price) > currentPrice 
                        ? 'text-green-400' 
                        : parseFloat(price) < currentPrice 
                        ? 'text-red-400' 
                        : 'text-gray-400'
                    }`}>
                      {parseFloat(price) > currentPrice 
                        ? `Above market by $${(parseFloat(price) - currentPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                        : parseFloat(price) < currentPrice 
                        ? `Below market by $${(currentPrice - parseFloat(price)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                        : 'At market price'}
                    </p>
                    <p className="text-xs text-blue-400 mt-1">
                      {orderType === 'buy' 
                        ? `Buy order will execute when price drops to $${parseFloat(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} or below`
                        : `Sell order will execute when price rises to $${parseFloat(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} or above`}
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

        {quantity && currentPrice > 0 && (() => {
          const TAX_RATE = 0.001; // 0.1% trading fee
          const baseAmount = parseFloat(quantity) * (orderMode === 'limit' && price ? parseFloat(price) : currentPrice);
          const taxAmount = baseAmount * TAX_RATE;
          const estimatedTotal = baseAmount + taxAmount;
          
          const formatPrice = (amount: number) => {
            return new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: 'USD',
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }).format(amount);
          };

          return (
            <div className="bg-gray-700 p-4 rounded-lg border border-gray-600 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-300">Subtotal:</span>
                <span className="text-white">{formatPrice(baseAmount)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-300">Trading Fee (0.1%):</span>
                <span className="text-white">{formatPrice(taxAmount)}</span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t border-gray-600">
                <span className="text-gray-300 font-medium">Total:</span>
                <span className="text-white font-semibold text-lg">
                  {formatPrice(estimatedTotal)}
                </span>
              </div>
            </div>
          );
        })()}

        <button
          type="submit"
          disabled={isLoading}
          className={`w-full py-2 px-4 rounded-lg font-medium text-white ${
            orderType === 'buy'
              ? 'bg-green-600 hover:bg-green-700'
              : 'bg-red-600 hover:bg-red-700'
          } disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center`}
        >
          {isLoading ? <LoadingSpinner size="sm" /> : `Place ${orderType.toUpperCase()} Order`}
        </button>
      </form>
    </div>
  );
}

