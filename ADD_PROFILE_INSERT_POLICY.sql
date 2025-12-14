-- Quick fix: Add INSERT policy for profiles table
-- Run this in Supabase SQL Editor

-- Drop existing policy if it exists (to avoid conflicts)
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;

-- Create the INSERT policy
CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Verify the policy was created
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
WHERE tablename = 'profiles'
ORDER BY policyname;
