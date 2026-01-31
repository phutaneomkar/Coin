# Cryptocurrency Dashboard - Indian Market

A real-time cryptocurrency trading dashboard built for the Indian market with Supabase backend, featuring real-time price updates, order placement (buy/sell with market/limit orders), watchlist, profile management, and automation capabilities.

## Features

✅ **Authentication** - Login, Signup, Logout with Supabase Auth  
✅ **Real-time Prices** - Live cryptocurrency prices in INR with auto-refresh  
✅ **Trading** - Place buy/sell orders with market and limit order types  
✅ **Watchlist** - Add/remove coins to track  
✅ **Profile** - View profile details and balance  
✅ **Automation** - Script-based trading automation (coming soon)  
✅ **Performance** - Optimized with caching, memoization, and error boundaries  
✅ **Indian Market** - INR currency, COINDCX API integration for production  

## Tech Stack

- **Frontend**: Next.js 14+ (App Router) with TypeScript
- **Styling**: Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Auth + Realtime)
- **State Management**: Zustand
- **API Testing**: CoinGecko Free API
- **API Production**: COINDCX API (Indian crypto exchange)
- **Notifications**: React Hot Toast
- **Icons**: Lucide React

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to SQL Editor and run the schema from `supabase/schema.sql`
3. Get your project URL and anon key from Settings > API

### 3. Configure Environment Variables

Create a `.env.local` file in the root directory:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# API Configuration
USE_TEST_API=true
NODE_ENV=development

# CoinGecko API (Free - for testing)
COINGECKO_API_URL=https://api.coingecko.com/api/v3

# COINDCX API (Production - Indian Market)
COINDCX_API_URL=https://api.coindcx.com
COINDCX_API_KEY=your_coindcx_api_key
COINDCX_API_SECRET=your_coindcx_api_secret
```

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Database Schema

The application uses the following Supabase tables:

- `profiles` - User profiles and balance
- `watchlist` - User's watched cryptocurrencies
- `orders` - Buy/sell orders (market and limit)
- `transactions` - Completed transactions
- `holdings` - User's cryptocurrency holdings

Automation uses the backend `strategies` table (see `backend/automation.sql`).

Run the SQL schema from `supabase/schema.sql` in your Supabase SQL Editor. If you have an existing DB with old automation tables, run `supabase/migrations/20250131000000_drop_unwanted_tables.sql` to remove them.

## API Configuration

### Testing Mode (Default)
- Uses CoinGecko Free API
- No API key required
- Limited to 10-50 calls/minute
- Set `USE_TEST_API=true` in `.env.local`

### Production Mode
- Uses COINDCX API (Indian crypto exchange)
- Requires API key and secret from COINDCX
- Set `USE_TEST_API=false` in `.env.local`
- Configure `COINDCX_API_KEY` and `COINDCX_API_SECRET`

## Project Structure

```
coin-dashboard/
├── app/
│   ├── (auth)/          # Authentication pages
│   ├── (dashboard)/     # Protected dashboard pages
│   ├── api/             # API routes
│   └── layout.tsx       # Root layout
├── components/
│   ├── auth/            # Authentication components
│   ├── dashboard/       # Dashboard components
│   ├── orders/          # Order components
│   └── shared/          # Shared components
├── lib/
│   ├── supabase/        # Supabase client setup
│   └── api/             # API clients (CoinGecko/COINDCX)
├── hooks/               # Custom React hooks
├── store/               # Zustand state management
├── types/               # TypeScript types
└── supabase/            # Database schema
```

## Key Features

### Order Placement
- **Buy Orders**: Market and limit orders with balance validation
- **Sell Orders**: Market and limit orders with holdings validation
- Real-time price display
- Order history tracking

### Real-time Prices
- Auto-refresh every 5 seconds
- Caching to minimize API calls
- Optimized with React.memo
- Error handling and retry logic

### Performance Optimizations
- React.memo for expensive components
- Zustand for fast state management
- API response caching
- Debounced updates
- Error boundaries
- Loading states

## Next Steps

1. **Set up Supabase** - Create project and run schema
2. **Configure environment** - Add your Supabase credentials
3. **Test locally** - Run `npm run dev`
4. **Add COINDCX credentials** - For production trading
5. **Build automation** - Implement script editor and executor

## Security

- Row Level Security (RLS) enabled on all tables
- API keys stored server-side only
- Input validation and sanitization
- Secure authentication with Supabase Auth

## License

MIT
