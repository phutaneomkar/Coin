-- Clean up holdings with 0 or negative quantity
-- Run this in Supabase SQL Editor to remove any orphaned holdings

-- First, check for holdings with 0 or negative quantity
SELECT 
  id,
  user_id,
  coin_id,
  coin_symbol,
  quantity,
  last_updated
FROM holdings
WHERE quantity <= 0
ORDER BY last_updated DESC;

-- Delete holdings with 0 or negative quantity
-- (This should have been done automatically, but this is a cleanup)
DELETE FROM holdings
WHERE quantity <= 0;

-- Verify deletion
SELECT COUNT(*) as remaining_zero_holdings
FROM holdings
WHERE quantity <= 0;




