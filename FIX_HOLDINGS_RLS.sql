-- Fix RLS policy for holdings INSERT
-- Run this in Supabase SQL Editor

-- First, check current policies
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

-- Drop existing INSERT policy if it exists
DROP POLICY IF EXISTS "Users can insert own holdings" ON holdings;

-- Create INSERT policy with proper WITH CHECK clause
-- The WITH CHECK ensures auth.uid() matches user_id for new rows
CREATE POLICY "Users can insert own holdings" ON holdings
  FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- Verify the policy was created
SELECT 
  policyname,
  cmd,
  with_check
FROM pg_policies
WHERE tablename = 'holdings' AND cmd = 'INSERT';





