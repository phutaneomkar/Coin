-- Add INSERT and DELETE policies for holdings table
-- Run this in Supabase SQL Editor if holdings INSERT is failing

-- Check if policies exist and drop them if they do
DROP POLICY IF EXISTS "Users can insert own holdings" ON holdings;
DROP POLICY IF EXISTS "Users can delete own holdings" ON holdings;

-- Create INSERT policy for holdings
CREATE POLICY "Users can insert own holdings" ON holdings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Create DELETE policy for holdings
CREATE POLICY "Users can delete own holdings" ON holdings
  FOR DELETE USING (auth.uid() = user_id);




