'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { usePriceStore } from '@/store/priceStore';
import { toast } from 'react-hot-toast';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { X, RefreshCw } from 'lucide-react';
import { OrderType, OrderMode } from '@/types';

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
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          setUserBalance(0);
          setUserHoldings(0);
          return;
        }

        // Fetch balance
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('balance_inr')
          .eq('id', user.id)
          .maybeSingle();

        if (profileError) {
          console.error('Error fetching profile:', profileError);
        }

        if (profile) {
          setUserBalance(parseFloat(profile.balance_inr?.toString() || '0'));
        } else {
          setUserBalance(0);
        }

        // Fetch holdings for this coin - try both lowercase and original case
        const normalizedCoinId = coinId.toLowerCase().trim();
        
        // First try with normalized coin_id
        let { data: holding, error: holdingError } = await supabase
          .from('holdings')
          .select('quantity, coin_id')
          .eq('user_id', user.id)
          .eq('coin_id', normalizedCoinId)
          .maybeSingle();

        // If not found, try case-insensitive search by fetching all holdings and matching
        if (!holding && !holdingError) {
          const { data: allHoldings, error: allHoldingsError } = await supabase
            .from('holdings')
            .select('quantity, coin_id')
            .eq('user_id', user.id);

          if (!allHoldingsError && allHoldings) {
            // Find matching coin (case-insensitive)
            holding = allHoldings.find(
              h => h.coin_id?.toLowerCase() === normalizedCoinId
            );
          }
        }

        if (holdingError) {
          console.error('Error fetching holdings:', holdingError);
        }

        if (holding && holding.quantity && parseFloat(holding.quantity.toString()) > 0) {
          const qty = parseFloat(holding.quantity.toString());
          setUserHoldings(qty);
          console.log(`Found holdings for ${coinId}:`, qty);
        } else {
          setUserHoldings(0);
          console.log(`No holdings found for ${coinId} (searched as: ${normalizedCoinId})`);
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
        // Set defaults on error
        setUserBalance(0);
        setUserHoldings(0);
      }
    };

    if (isOpen && coinId) {
      fetchUserData();
    } else {
      // Reset when modal closes
      setUserBalance(null);
      setUserHoldings(null);
    }
  }, [isOpen, coinId, supabase]);

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

      // Check holdings for sell orders - with case-insensitive matching
      if (orderType === 'sell') {
        const normalizedCoinId = coinId.toLowerCase().trim();
        
        // First try with normalized coin_id
        let { data: holding, error: holdingError } = await supabase
          .from('holdings')
          .select('quantity, coin_id')
          .eq('user_id', user.id)
          .eq('coin_id', normalizedCoinId)
          .maybeSingle();

        // If not found, try case-insensitive search
        if (!holding && !holdingError) {
          const { data: allHoldings } = await supabase
            .from('holdings')
            .select('quantity, coin_id')
            .eq('user_id', user.id);

          if (allHoldings) {
            holding = allHoldings.find(
              h => h.coin_id?.toLowerCase() === normalizedCoinId
            );
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
      const {
        data: { user: refreshedUser },
      } = await supabase.auth.getUser();
      
      if (refreshedUser) {
        // Refresh balance
        const { data: profile } = await supabase
          .from('profiles')
          .select('balance_inr')
          .eq('id', refreshedUser.id)
          .maybeSingle();
        if (profile) {
          setUserBalance(parseFloat(profile.balance_inr?.toString() || '0'));
        }
        
        // Refresh holdings
        const normalizedCoinId = coinId.toLowerCase().trim();
        const { data: holding } = await supabase
          .from('holdings')
          .select('quantity, coin_id')
          .eq('user_id', refreshedUser.id)
          .eq('coin_id', normalizedCoinId)
          .maybeSingle();
        
        if (holding && holding.quantity) {
          setUserHoldings(parseFloat(holding.quantity.toString()));
        } else {
          // Try case-insensitive search
          const { data: allHoldings } = await supabase
            .from('holdings')
            .select('quantity, coin_id')
            .eq('user_id', refreshedUser.id);
          
          if (allHoldings) {
            const matched = allHoldings.find(
              h => h.coin_id?.toLowerCase() === normalizedCoinId
            );
            if (matched) {
              setUserHoldings(parseFloat(matched.quantity.toString()));
            } else {
              setUserHoldings(0);
            }
          } else {
            setUserHoldings(0);
          }
        }
      }
      
      onOrderPlaced?.();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to place order');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(price);
  };

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

  // Quick percentage buttons (25%, 50%, 75%, 100%)
  const handlePercentageClick = (percentage: number) => {
    const available = getAvailableAmount();
    if (orderType === 'buy' && currentPrice > 0) {
      // For buy: calculate quantity based on available balance
      const maxQuantity = (available / currentPrice) * (percentage / 100);
      setQuantity(maxQuantity.toFixed(8).replace(/\.?0+$/, ''));
    } else if (orderType === 'sell') {
      // For sell: use available holdings directly
      const sellQuantity = available * (percentage / 100);
      setQuantity(sellQuantity.toFixed(8).replace(/\.?0+$/, ''));
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
                // Refresh holdings and balance
                const {
                  data: { user },
                } = await supabase.auth.getUser();
                if (user) {
                  const { data: profile } = await supabase
                    .from('profiles')
                    .select('balance_inr')
                    .eq('id', user.id)
                    .maybeSingle();
                  if (profile) {
                    setUserBalance(parseFloat(profile.balance_inr?.toString() || '0'));
                  }
                  
                  const normalizedCoinId = coinId.toLowerCase().trim();
                  const { data: holding } = await supabase
                    .from('holdings')
                    .select('quantity, coin_id')
                    .eq('user_id', user.id)
                    .eq('coin_id', normalizedCoinId)
                    .maybeSingle();
                  
                  if (holding && holding.quantity) {
                    setUserHoldings(parseFloat(holding.quantity.toString()));
                  } else {
                    const { data: allHoldings } = await supabase
                      .from('holdings')
                      .select('quantity, coin_id')
                      .eq('user_id', user.id);
                    if (allHoldings) {
                      const matched = allHoldings.find(
                        h => h.coin_id?.toLowerCase() === normalizedCoinId
                      );
                      setUserHoldings(matched ? parseFloat(matched.quantity.toString()) : 0);
                    } else {
                      setUserHoldings(0);
                    }
                  }
                  toast.success('Holdings refreshed');
                }
              }}
              className="text-gray-400 hover:text-white transition-colors p-1"
              title="Refresh holdings"
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
                className={`flex-1 py-3 px-4 rounded-lg font-semibold text-lg transition-all ${
                  orderType === 'buy'
                    ? 'bg-green-600 text-white shadow-lg shadow-green-600/30'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
              >
                BUY
              </button>
              <button
                type="button"
                onClick={() => setOrderType('sell')}
                className={`flex-1 py-3 px-4 rounded-lg font-semibold text-lg transition-all ${
                  orderType === 'sell'
                    ? 'bg-red-600 text-white shadow-lg shadow-red-600/30'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
              >
                SELL
              </button>
            </div>
            
            {/* Available Balance/Holdings Display - CoinDCX Style */}
            <div className={`p-4 rounded-lg mb-4 border-2 ${
              orderType === 'buy' 
                ? 'bg-green-900/20 border-green-700/50' 
                : 'bg-red-900/20 border-red-700/50'
            }`}>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-400">
                  {orderType === 'buy' ? 'Available Balance' : 'Available Holdings'}
                </span>
                <span className={`text-xl font-bold ${
                  orderType === 'buy' ? 'text-green-400' : 'text-red-400'
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
                className={`flex-1 py-2 px-4 rounded-md font-medium transition-all ${
                  orderMode === 'market'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                Market
              </button>
              <button
                type="button"
                onClick={() => setOrderMode('limit')}
                className={`flex-1 py-2 px-4 rounded-md font-medium transition-all ${
                  orderMode === 'limit'
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
            
            {/* Quick Percentage Buttons - CoinDCX Style */}
            <div className="flex gap-2 mt-2">
              {[25, 50, 75, 100].map((percent) => (
                <button
                  key={percent}
                  type="button"
                  onClick={() => handlePercentageClick(percent)}
                  className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors ${
                    orderType === 'buy'
                      ? 'bg-green-900/30 text-green-400 hover:bg-green-900/50 border border-green-700/50'
                      : 'bg-red-900/30 text-red-400 hover:bg-red-900/50 border border-red-700/50'
                  }`}
                >
                  {percent}%
                </button>
              ))}
            </div>
            
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
                      <p className={`text-xs ${
                        parseFloat(price) > currentPrice 
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
            <div className={`p-4 rounded-lg border-2 space-y-3 ${
              orderType === 'buy' 
                ? 'bg-green-900/10 border-green-700/50' 
                : 'bg-red-900/10 border-red-700/50'
            }`}>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">
                  {orderType === 'buy' ? 'You Pay' : 'You Receive'}
                </span>
                <span className={`font-semibold text-lg ${
                  orderType === 'buy' ? 'text-green-400' : 'text-red-400'
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
            className={`w-full py-4 px-4 rounded-lg font-bold text-lg text-white shadow-lg transition-all ${
              orderType === 'buy'
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
