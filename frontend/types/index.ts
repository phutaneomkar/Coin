// User Types
export interface User {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  pan_card: string | null;
  kyc_status: 'pending' | 'verified' | 'rejected';
  balance_inr: number;
  created_at: string;
  updated_at: string;
}

// Crypto Types
export interface CryptoPrice {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  market_cap: number;
  volume_24h: number;
  last_updated: string;
}

export interface CoinDetail {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  market_cap: number;
  volume_24h: number;
  high_24h: number;
  low_24h: number;
  last_updated: string;
}

// Order Types
export type OrderType = 'buy' | 'sell';
export type OrderStatus = 'pending' | 'completed' | 'cancelled';
export type OrderMode = 'market' | 'limit';

export interface Order {
  id: string;
  user_id: string;
  coin_id: string;
  coin_symbol: string;
  order_type: OrderType;
  order_mode: OrderMode;
  order_status: OrderStatus;
  quantity: number;
  price_per_unit: number | null; // null for market orders
  total_amount: number;
  order_date: string;
  completed_at: string | null;
}

// Watchlist Types
export interface WatchlistItem {
  id: string;
  user_id: string;
  coin_id: string;
  coin_symbol: string;
  added_at: string;
}

// Transaction Types
export interface Transaction {
  id: string;
  user_id: string;
  order_id: string;
  transaction_type: OrderType;
  coin_id: string;
  coin_symbol: string;
  quantity: number;
  price_per_unit: number;
  total_amount: number;
  transaction_date: string;
}

// Holdings Types
export interface Holding {
  id: string;
  user_id: string;
  coin_id: string;
  coin_symbol: string;
  quantity: number;
  average_buy_price: number;
  last_updated: string;
}

// Automation Script Types
export type ScriptType = 'price_trigger' | 'scheduled' | 'indicator' | 'custom';

export interface AutomationScript {
  id: string;
  user_id: string;
  script_name: string;
  script_code: string;
  script_type: ScriptType;
  is_active: boolean;
  config: Record<string, any>;
  created_at: string;
  updated_at: string;
  last_executed_at: string | null;
}

export interface ScriptExecution {
  id: string;
  script_id: string;
  user_id: string;
  execution_status: 'success' | 'failed' | 'running';
  orders_placed: number;
  error_message: string | null;
  execution_log: Record<string, any>;
  started_at: string;
  completed_at: string | null;
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

