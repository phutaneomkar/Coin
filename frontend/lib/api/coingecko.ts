import { CryptoPrice } from '@/types';
import { requestDeduplicator } from './requestDeduplicator';

const COINGECKO_API_URL = 'https://api.coingecko.com/api/v3';

// Coins supported by Indian exchanges (WazirX, CoinDCX, etc.)
const INDIAN_EXCHANGE_COINS = [
  'bitcoin',
  'ethereum',
  'binancecoin',
  'solana',
  'cardano',
  'ripple',
  'polkadot',
  'dogecoin',
  'avalanche-2',
  'polygon',
  'chainlink',
  'litecoin',
  'uniswap',
  'bitcoin-cash',
  'stellar',
  'tether',
  'usd-coin',
  'shiba-inu',
  'matic-network',
  'cosmos',
  'algorand',
  'filecoin',
  'tron',
  'ethereum-classic',
  'vechain',
  'theta-token',
  'aave',
  'compound-governance-token',
  'maker',
  'dai',
  'wrapped-bitcoin',
  'eos',
  'tezos',
  'monero',
  'dash',
  'zcash',
  'decentraland',
  'the-sandbox',
  'axie-infinity',
  'enjincoin',
  'gala',
  'mana',
  'flow',
  'near',
  'aptos',
  'optimism',
  'arbitrum',
  'immutable-x',
  'loopring',
  'zilliqa',
  'bittorrent',
];

/**
 * @deprecated This function now uses Binance API instead of CoinGecko
 * The API route has been updated to use Binance
 */
export async function fetchCryptoPrices(): Promise<CryptoPrice[]> {
  // Note: API route now uses Binance instead of CoinGecko
  try {
    // Use Next.js API route to avoid CORS issues
    // The API route fetches from Binance server-side where CORS doesn't apply
    // Use cache to reduce API calls and prevent rate limits
    const response = await fetch('/api/crypto/prices', {
      next: { revalidate: 60 }, // Revalidate every 1 minute
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      let errorMessage = `Failed to fetch prices: ${response.statusText}`;
      let errorDetails = '';
      
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
        errorDetails = errorData.details || '';
      } catch (e) {
        // If response is not JSON, use status text
        const text = await response.text().catch(() => '');
        if (text) {
          errorMessage = text;
        }
      }
      
      // Handle rate limiting specifically
      if (response.status === 429) {
        throw new Error(errorDetails || 'Rate limit exceeded. Please wait a moment and refresh the page.');
      }
      
      throw new Error(errorMessage);
    }

    const prices: CryptoPrice[] = await response.json();
    
    if (!Array.isArray(prices)) {
      throw new Error('Invalid response format: expected array of prices');
    }
    
    return prices;
  } catch (error) {
    // Re-throw with more context
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to fetch crypto prices: Unknown error');
  }
}

function formatCoinName(coinId: string): string {
  const nameMap: Record<string, string> = {
    bitcoin: 'Bitcoin',
    ethereum: 'Ethereum',
    binancecoin: 'BNB',
    solana: 'Solana',
    cardano: 'Cardano',
    ripple: 'Ripple',
    polkadot: 'Polkadot',
    dogecoin: 'Dogecoin',
    'avalanche-2': 'Avalanche',
    polygon: 'Polygon',
    chainlink: 'Chainlink',
    litecoin: 'Litecoin',
    uniswap: 'Uniswap',
    'bitcoin-cash': 'Bitcoin Cash',
    stellar: 'Stellar',
  };

  return nameMap[coinId] || coinId.charAt(0).toUpperCase() + coinId.slice(1);
}
