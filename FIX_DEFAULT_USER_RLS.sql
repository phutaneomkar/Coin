-- Fix RLS policies to allow DEFAULT_USER_ID to work
-- This script allows the hardcoded DEFAULT_USER_ID (00000000-0000-0000-0000-000000000000) to work
-- Run this in Supabase SQL Editor

-- Step 1: Create a user in auth.users if it doesn't exist (required for foreign key constraint)
-- Note: This requires superuser privileges. If you can't create users directly,
-- you may need to use the Supabase dashboard or modify the schema to not require auth.users reference.

-- First, let's check if the user exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000000') THEN
    -- Insert a dummy user (this may require superuser privileges)
    -- If this fails, you'll need to create the user through Supabase dashboard
    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin,
      role
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-000000000000',
      'investor@coin.local',
      crypt('dummy', gen_salt('bf')), -- Dummy password
      NOW(),
      NOW(),
      NOW(),
      '{}',
      '{"full_name": "Default Investor"}',
      false,
      'authenticated'
    ) ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- Step 2: Create or replace the profile for DEFAULT_USER_ID
INSERT INTO profiles (
  id,
  email,
  full_name,
  balance_inr,
  kyc_status
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'investor@coin.local',
  'Default Investor',
  0,
  'verified'
) ON CONFLICT (id) DO UPDATE
SET
  email = EXCLUDED.email,
  full_name = EXCLUDED.full_name,
  kyc_status = COALESCE(profiles.kyc_status, EXCLUDED.kyc_status);

-- Step 3: Drop existing RLS policies and recreate them to allow DEFAULT_USER_ID
-- Note: When there's no authenticated user, auth.uid() returns NULL
-- We allow operations for DEFAULT_USER_ID when auth.uid() IS NULL or when it matches

-- Profiles policies
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (
    auth.uid() = id 
    OR (auth.uid() IS NULL AND id = '00000000-0000-0000-0000-000000000000')
  );

CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (
    auth.uid() = id 
    OR (auth.uid() IS NULL AND id = '00000000-0000-0000-0000-000000000000')
  );

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (
    auth.uid() = id 
    OR (auth.uid() IS NULL AND id = '00000000-0000-0000-0000-000000000000')
  );

-- Watchlist policies
DROP POLICY IF EXISTS "Users can view own watchlist" ON watchlist;
DROP POLICY IF EXISTS "Users can insert own watchlist" ON watchlist;
DROP POLICY IF EXISTS "Users can delete own watchlist" ON watchlist;

CREATE POLICY "Users can view own watchlist" ON watchlist
  FOR SELECT USING (
    auth.uid() = user_id 
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000')
  );

CREATE POLICY "Users can insert own watchlist" ON watchlist
  FOR INSERT WITH CHECK (
    auth.uid() = user_id 
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000')
  );

CREATE POLICY "Users can delete own watchlist" ON watchlist
  FOR DELETE USING (
    auth.uid() = user_id 
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000')
  );

-- Orders policies
DROP POLICY IF EXISTS "Users can view own orders" ON orders;
DROP POLICY IF EXISTS "Users can insert own orders" ON orders;
DROP POLICY IF EXISTS "Users can update own orders" ON orders;

CREATE POLICY "Users can view own orders" ON orders
  FOR SELECT USING (
    auth.uid() = user_id 
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000')
  );

CREATE POLICY "Users can insert own orders" ON orders
  FOR INSERT WITH CHECK (
    auth.uid() = user_id 
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000')
  );

CREATE POLICY "Users can update own orders" ON orders
  FOR UPDATE USING (
    auth.uid() = user_id 
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000')
  );

-- Holdings policies
DROP POLICY IF EXISTS "Users can view own holdings" ON holdings;
DROP POLICY IF EXISTS "Users can insert own holdings" ON holdings;
DROP POLICY IF EXISTS "Users can update own holdings" ON holdings;
DROP POLICY IF EXISTS "Users can delete own holdings" ON holdings;

CREATE POLICY "Users can view own holdings" ON holdings
  FOR SELECT USING (
    auth.uid() = user_id 
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000')
  );

CREATE POLICY "Users can insert own holdings" ON holdings
  FOR INSERT WITH CHECK (
    auth.uid() = user_id 
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000')
  );

CREATE POLICY "Users can update own holdings" ON holdings
  FOR UPDATE USING (
    auth.uid() = user_id 
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000')
  );

CREATE POLICY "Users can delete own holdings" ON holdings
  FOR DELETE USING (
    auth.uid() = user_id 
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000')
  );

-- Transactions policies
DROP POLICY IF EXISTS "Users can view own transactions" ON transactions;

CREATE POLICY "Users can view own transactions" ON transactions
  FOR SELECT USING (
    auth.uid() = user_id 
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000')
  );

-- Automation scripts policies
DROP POLICY IF EXISTS "Users can view own scripts" ON automation_scripts;
DROP POLICY IF EXISTS "Users can insert own scripts" ON automation_scripts;
DROP POLICY IF EXISTS "Users can update own scripts" ON automation_scripts;
DROP POLICY IF EXISTS "Users can delete own scripts" ON automation_scripts;

CREATE POLICY "Users can view own scripts" ON automation_scripts
  FOR SELECT USING (
    auth.uid() = user_id 
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000')
  );

CREATE POLICY "Users can insert own scripts" ON automation_scripts
  FOR INSERT WITH CHECK (
    auth.uid() = user_id 
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000')
  );

CREATE POLICY "Users can update own scripts" ON automation_scripts
  FOR UPDATE USING (
    auth.uid() = user_id 
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000')
  );

CREATE POLICY "Users can delete own scripts" ON automation_scripts
  FOR DELETE USING (
    auth.uid() = user_id 
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000')
  );

-- Script executions policies
DROP POLICY IF EXISTS "Users can view own script executions" ON script_executions;
DROP POLICY IF EXISTS "Users can insert own script executions" ON script_executions;

CREATE POLICY "Users can view own script executions" ON script_executions
  FOR SELECT USING (
    auth.uid() = user_id 
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000')
  );

CREATE POLICY "Users can insert own script executions" ON script_executions
  FOR INSERT WITH CHECK (
    auth.uid() = user_id 
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000')
  );

-- Verify the profile was created
SELECT 
  id,
  email,
  full_name,
  balance_inr,
  kyc_status
FROM profiles
WHERE id = '00000000-0000-0000-0000-000000000000';

-- Verify policies were created
SELECT 
  schemaname,
  tablename,
  policyname,
  cmd
FROM pg_policies
WHERE tablename IN ('profiles', 'watchlist', 'orders', 'holdings', 'transactions', 'automation_scripts', 'script_executions')
ORDER BY tablename, policyname;

