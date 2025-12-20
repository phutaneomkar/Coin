
-- Table to store automation strategies
create table if not exists strategies (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  amount decimal not null, -- "Price Limit" / Investment Amount per trade
  profit_percentage decimal not null, -- Target profit %
  total_iterations int not null, -- "Order" count
  iterations_completed int default 0,
  duration_minutes int not null,
  start_time timestamptz default now(),
  end_time timestamptz, -- Calculated by trigger or application
  status text check (status in ('running', 'paused', 'completed', 'stopped')) default 'running',
  
  -- State persistence
  current_coin_id text, -- If currently in a trade
  current_order_id uuid, -- Track the active order (Buy or Sell)
  current_coin_symbol text,
  entry_price decimal, -- Price bought at
  entry_quantity decimal, -- Quantity bought
  
  created_at timestamptz default now()
);

-- Table to log automation actions (Buy/Sell history)
create table if not exists strategy_logs (
  id uuid default gen_random_uuid() primary key,
  strategy_id uuid references strategies(id) on delete cascade,
  action text check (action in ('buy', 'sell')),
  coin_id text,
  coin_symbol text,
  price decimal,
  quantity decimal,
  amount decimal, -- Total value (price * quantity)
  profit decimal, -- For sell orders only
  timestamp timestamptz default now()
);

-- RLS Policies (Optional but recommended)
alter table strategies enable row level security;
create policy "Users can view own strategies" on strategies for select using (auth.uid() = user_id);
create policy "Users can insert own strategies" on strategies for insert with check (auth.uid() = user_id);
create policy "Users can update own strategies" on strategies for update using (auth.uid() = user_id);

alter table strategy_logs enable row level security;
create policy "Users can view own logs" on strategy_logs for select using (
  exists (select 1 from strategies where id = strategy_logs.strategy_id and user_id = auth.uid())
);
