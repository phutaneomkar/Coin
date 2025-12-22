-- Complete fix for holdings RLS policy issue
-- Run this in Supabase SQL Editor

-- Step 1: Check current policies
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'holdings'
ORDER BY policyname;

-- Step 2: Drop existing INSERT policy if it exists
DROP POLICY IF EXISTS "Users can insert own holdings" ON holdings;

-- Step 3: Create INSERT policy with proper WITH CHECK clause
-- The WITH CHECK ensures auth.uid() matches user_id for new rows
CREATE POLICY "Users can insert own holdings" ON holdings
  FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- Step 4: Verify the policy was created correctly
SELECT 
  policyname,
  cmd,
  with_check
FROM pg_policies
WHERE tablename = 'holdings' AND cmd = 'INSERT';

-- Step 5: Test the policy (optional - run as authenticated user)
-- This should work if you're logged in:
-- INSERT INTO holdings (user_id, coin_id, coin_symbol, quantity, average_buy_price)
-- VALUES (auth.uid(), 'btc', 'BTC', 1.0, 50000.0);






