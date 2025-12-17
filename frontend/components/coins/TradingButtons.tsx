'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TradingModal } from './TradingModal';

interface CoinDetail {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
}

interface TradingButtonsProps {
  coin: CoinDetail;
}

export function TradingButtons({ coin }: TradingButtonsProps) {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [orderType, setOrderType] = useState<'buy' | 'sell'>('buy');

  const handleBuy = () => {
    setOrderType('buy');
    setIsModalOpen(true);
  };

  const handleSell = () => {
    setOrderType('sell');
    setIsModalOpen(true);
  };

  return (
    <>
      <div className="flex flex-col gap-3">
        <button
          onClick={handleBuy}
          className="w-full py-4 bg-green-600 hover:bg-green-700 text-white font-bold text-lg rounded-lg transition-all shadow-lg shadow-green-600/30 hover:shadow-green-600/50"
        >
          BUY {coin.symbol}
        </button>
        <button
          onClick={handleSell}
          className="w-full py-4 bg-red-600 hover:bg-red-700 text-white font-bold text-lg rounded-lg transition-all shadow-lg shadow-red-600/30 hover:shadow-red-600/50"
        >
          SELL {coin.symbol}
        </button>
      </div>

      <TradingModal
        isOpen={isModalOpen}
        onOrderPlaced={async () => {
          setIsModalOpen(false);
          router.push('/orders?tab=portfolio');
          window.dispatchEvent(new CustomEvent('order-placed'));
        }}
        onClose={() => setIsModalOpen(false)}
        coinId={coin.id}
        coinSymbol={coin.symbol}
        currentPrice={coin.current_price}
        orderType={orderType}
      />
    </>
  );
}
