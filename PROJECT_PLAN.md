# Cryptocurrency Dashboard - Project Plan

## Project Overview
A real-time cryptocurrency dashboard for the Indian market with trading capabilities, watchlist, and user management using Supabase.

## Tech Stack
- **Frontend**: Next.js 14+ (App Router) with TypeScript
- **Styling**: Tailwind CSS
- **Backend/Database**: Supabase (PostgreSQL + Auth + Realtime)
- **API Testing**: CoinGecko Free API for development/testing
- **API Production**: COINDCX API (Indian crypto exchange API)
- **State Management**: Zustand for fast state management
- **Real-time Updates**: WebSocket connections, optimized polling with caching
- **Performance**: React.memo, useMemo, useCallback for optimization

## Features Breakdown

### 1. Authentication System
- **Login**: Email/Password authentication via Supabase Auth
- **Signup**: User registration with email verification
- **Logout**: Session termination
- **Protected Routes**: Route guards for authenticated pages

### 2. Real-Time Crypto Data
- **Price Display**: Live cryptocurrency prices in INR
- **Price Charts**: Historical price charts (using Chart.js or Recharts)
- **Market Data**: 24h volume, market cap, price change %
- **Auto-refresh**: Real-time price updates (WebSocket or polling)

### 3. Trading Features
- **Place Buy Order**: 
  - Select cryptocurrency
  - Enter quantity
  - Set price (market/limit orders)
  - Validate sufficient balance
  - Store in Supabase
  
- **Place Sell Order**:
  - Select owned cryptocurrency
  - Enter quantity
  - Set price (market/limit orders)
  - Validate holdings
  - Store in Supabase

- **Order Management**:
  - View active orders
  - Cancel orders
  - Order history

### 4. Watchlist
- **Add to Watchlist**: Add cryptocurrencies to personal watchlist
- **Remove from Watchlist**: Remove coins
- **Watchlist View**: Dedicated page showing watched coins with prices
- **Quick Actions**: Quick buy/sell from watchlist

### 5. User Profile
- **Profile Details**: 
  - Name, email, phone
  - KYC status (for Indian market compliance)
  - Account balance (INR)
  - Portfolio value
  
- **Transaction History**:
  - All buy/sell transactions
  - Filter by date, coin, type
  - Export functionality

- **Portfolio**:
  - Holdings breakdown
  - Profit/Loss calculation
  - Asset allocation chart

### 6. Automation/Scripting Feature
- **Script Editor**: Code editor for writing trading scripts
- **Script Execution**: Run automated trading strategies
- **Script Management**: Save, edit, delete, and schedule scripts
- **Script Types**:
  - Price-based triggers (buy when price drops, sell when price rises)
  - Time-based orders (scheduled buy/sell)
  - Technical indicators (moving averages, RSI, etc.)
  - Custom logic scripts
- **Script Logs**: Execution history and debugging
- **Safety Features**: Risk limits, max order size, stop-loss

### 7. Indian Market Specific
- **Currency**: All prices in INR (Indian Rupees)
- **Compliance**: KYC fields, PAN card, Aadhaar (optional)
- **Tax Information**: Transaction tax calculations
- **Production API**: COINDCX API integration for live trading

## Database Schema (Supabase)

### 1. `profiles` table
```sql
- id (uuid, primary key, references auth.users)
- email (text)
- full_name (text)
- phone (text)
- pan_card (text, nullable)
- kyc_status (text, default 'pending')
- balance_inr (numeric, default 0)
- created_at (timestamp)
- updated_at (timestamp)
```

### 2. `watchlist` table
```sql
- id (uuid, primary key)
- user_id (uuid, references profiles.id)
- coin_id (text) -- e.g., 'bitcoin', 'ethereum'
- coin_symbol (text) -- e.g., 'BTC', 'ETH'
- added_at (timestamp)
- unique(user_id, coin_id)
```

### 3. `orders` table
```sql
- id (uuid, primary key)
- user_id (uuid, references profiles.id)
- coin_id (text)
- coin_symbol (text)
- order_type (text) -- 'buy' or 'sell'
- order_status (text) -- 'pending', 'completed', 'cancelled'
- quantity (numeric)
- price_per_unit (numeric)
- total_amount (numeric)
- order_date (timestamp)
- completed_at (timestamp, nullable)
```

### 4. `transactions` table
```sql
- id (uuid, primary key)
- user_id (uuid, references profiles.id)
- order_id (uuid, references orders.id)
- transaction_type (text) -- 'buy' or 'sell'
- coin_id (text)
- coin_symbol (text)
- quantity (numeric)
- price_per_unit (numeric)
- total_amount (numeric)
- transaction_date (timestamp)
```

### 5. `holdings` table (or computed from transactions)
```sql
- id (uuid, primary key)
- user_id (uuid, references profiles.id)
- coin_id (text)
- coin_symbol (text)
- quantity (numeric)
- average_buy_price (numeric)
- last_updated (timestamp)
- unique(user_id, coin_id)
```

### 6. `automation_scripts` table
```sql
- id (uuid, primary key)
- user_id (uuid, references profiles.id)
- script_name (text)
- script_code (text) -- JavaScript/TypeScript code
- script_type (text) -- 'price_trigger', 'scheduled', 'indicator', 'custom'
- is_active (boolean, default false)
- config (jsonb) -- Script configuration (triggers, limits, etc.)
- created_at (timestamp)
- updated_at (timestamp)
- last_executed_at (timestamp, nullable)
```

### 7. `script_executions` table
```sql
- id (uuid, primary key)
- script_id (uuid, references automation_scripts.id)
- user_id (uuid, references profiles.id)
- execution_status (text) -- 'success', 'failed', 'running'
- orders_placed (integer, default 0)
- error_message (text, nullable)
- execution_log (jsonb)
- started_at (timestamp)
- completed_at (timestamp, nullable)
```

## Project Structure

```
frontend/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   └── signup/
│   ├── (dashboard)/
│   │   ├── dashboard/
│   │   ├── orders/
│   │   ├── watchlist/
│   │   ├── automation/
│   │   └── profile/
│   ├── api/
│   │   ├── crypto/
│   │   └── scripts/
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── auth/
│   ├── dashboard/
│   ├── orders/
│   ├── watchlist/
│   ├── automation/
│   └── shared/
├── lib/
│   ├── supabase/
│   ├── api/
│   │   ├── coingecko.ts (test API)
│   │   ├── coindcx.ts (production API)
│   │   └── api-client.ts (abstraction layer)
│   ├── scripts/
│   │   ├── executor.ts
│   │   └── sandbox.ts
│   └── utils/
├── types/
│   └── index.ts
├── hooks/
│   ├── useCryptoPrices.ts
│   └── useScriptExecutor.ts
├── store/
│   └── priceStore.ts (Zustand)
└── public/
```

## API Integration

### Testing/Development: CoinGecko Free API
- **Free Tier**: 10-50 calls/minute
- **Endpoint**: `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=inr`
- **Real-time**: Optimized polling with caching (5-10 second intervals)
- **Caching**: Redis-like caching to minimize API calls
- **Environment**: Used when `NODE_ENV=development` or `USE_TEST_API=true`

### Production: COINDCX API
- **Base URL**: `https://api.coindcx.com`
- **Authentication**: API Key + Secret (HMAC SHA256)
- **Endpoints**:
  - Market data: `/exchange/v1/markets`
  - Ticker: `/exchange/v1/markets_details`
  - Order placement: `/exchange/v1/orders/create`
  - Order status: `/exchange/v1/orders/status`
  - WebSocket: `wss://api.coindcx.com/exchange/v1/ws`
- **Rate Limits**: Respect COINDCX rate limits
- **Environment**: Used when `NODE_ENV=production` and `USE_TEST_API=false`

### API Abstraction Layer
- **Strategy Pattern**: Switch between CoinGecko (test) and COINDCX (prod)
- **Unified Interface**: Same interface for both APIs
- **Error Handling**: Graceful fallback and retry logic
- **Performance**: Request batching, connection pooling, caching

## Implementation Phases

### Phase 1: Foundation
1. Initialize Next.js project with TypeScript
2. Set up Supabase project and configure client
3. Create database schema and tables
4. Set up authentication flow

### Phase 2: Core Features
1. Build dashboard layout and navigation
2. Implement real-time price display
3. Create watchlist functionality
4. Build profile page

### Phase 3: Trading
1. Implement order placement (buy/sell)
2. Create order management system
3. Build transaction history
4. Add portfolio tracking

### Phase 4: Automation
1. Build script editor component
2. Implement script execution engine (sandboxed)
3. Create script management (save, edit, delete)
4. Add script execution logs and monitoring

### Phase 5: Polish & Performance
1. Add charts and visualizations
2. Implement Indian market compliance features
3. Add error handling and validation
4. **Performance Optimizations**:
   - React.memo for expensive components
   - useMemo/useCallback for calculations
   - Virtual scrolling for large lists
   - Debounced API calls
   - WebSocket connection pooling
   - Client-side caching with IndexedDB
   - Lazy loading components
   - Code splitting
5. **Glitch Prevention**:
   - Error boundaries
   - Loading states
   - Skeleton screens
   - Optimistic UI updates
   - Request deduplication

## Security Considerations
- Row Level Security (RLS) policies in Supabase
- Input validation and sanitization
- Rate limiting on API calls
- Secure authentication tokens
- KYC data encryption
- **Script Security**: Sandboxed script execution (VM2 or isolated worker)
- **API Key Security**: Server-side only, never expose in client
- **Order Validation**: Server-side validation for all orders
- **Risk Limits**: Maximum order size, daily limits per user

## Next Steps
1. Initialize the Next.js project
2. Set up Supabase project and get API keys
3. Create database schema
4. Build authentication system
5. Implement real-time price fetching
6. Build UI components progressively

