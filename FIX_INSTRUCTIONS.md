# Fix Instructions for Watchlist, Profile, and Buy/Sell Issues

## Issues Fixed

1. ✅ **Missing `useCallback` import** in watchlist page
2. ✅ **TradingModal and OrderForm** now use `DEFAULT_USER_ID` instead of `auth.getUser()`
3. ✅ **SQL script created** to fix RLS policies for `DEFAULT_USER_ID`

## What You Need to Do

### Step 1: Run the SQL Script

1. Go to your **Supabase Dashboard** → **SQL Editor**
2. Open the file `FIX_DEFAULT_USER_RLS.sql`
3. Copy and paste the entire SQL script into the SQL Editor
4. Click **Run** to execute the script

This script will:
- Create a user in `auth.users` with the DEFAULT_USER_ID (if it doesn't exist)
- Create a profile for the DEFAULT_USER_ID
- Update all RLS policies to allow operations for DEFAULT_USER_ID when there's no authenticated user

### Step 2: Verify the Profile Exists

After running the SQL script, verify that the profile was created:

1. Go to **Supabase Dashboard** → **Table Editor** → `profiles`
2. Look for a row with `id = 00000000-0000-0000-0000-000000000000`
3. If it exists, you're good to go!

### Step 3: Test the Application

1. **Refresh your application**
2. **Test Watchlist**: Try adding a coin to your watchlist
3. **Test Profile**: Navigate to the profile page - it should load your profile
4. **Test Buy/Sell**: Try placing a buy or sell order

## What Was Changed

### Code Changes

1. **`frontend/app/(dashboard)/watchlist/page.tsx`**
   - Added missing `useCallback` import

2. **`frontend/components/coins/TradingModal.tsx`**
   - Replaced all `supabase.auth.getUser()` calls with `DEFAULT_USER_ID`
   - Now uses `DEFAULT_USER_ID` directly instead of trying to get authenticated user

3. **`frontend/components/orders/OrderForm.tsx`**
   - Replaced all `supabase.auth.getUser()` calls with `DEFAULT_USER_ID`
   - Now uses `DEFAULT_USER_ID` directly instead of trying to get authenticated user

### Database Changes

The SQL script (`FIX_DEFAULT_USER_RLS.sql`) updates RLS policies to allow operations for `DEFAULT_USER_ID` when there's no authenticated user. The policies now check:
- `auth.uid() = user_id` (for authenticated users)
- OR `auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000'` (for the default user)

## Troubleshooting

### If the SQL script fails:

1. **User creation fails**: You may need to create the user manually through Supabase Dashboard:
   - Go to **Authentication** → **Users**
   - Click **Add User**
   - Set ID to: `00000000-0000-0000-0000-000000000000`
   - Set Email to: `investor@coin.local`
   - Set Password to any value (it won't be used)

2. **Profile creation fails**: The profile should be created automatically, but if it doesn't:
   - Go to **Table Editor** → `profiles`
   - Click **Insert row**
   - Fill in:
     - `id`: `00000000-0000-0000-0000-000000000000`
     - `email`: `investor@coin.local`
     - `full_name`: `Default Investor`
     - `balance_inr`: `0`
     - `kyc_status`: `verified`

### If operations still fail:

1. Check the browser console for errors
2. Verify that the RLS policies were created correctly:
   ```sql
   SELECT tablename, policyname, cmd 
   FROM pg_policies 
   WHERE tablename IN ('profiles', 'watchlist', 'orders', 'holdings')
   ORDER BY tablename, policyname;
   ```

3. Make sure the profile exists:
   ```sql
   SELECT * FROM profiles WHERE id = '00000000-0000-0000-0000-000000000000';
   ```

## Notes

- The application is designed to work without authentication using a hardcoded `DEFAULT_USER_ID`
- All RLS policies have been updated to allow this default user to work
- The profile page will automatically create a profile if it doesn't exist (but the SQL script should handle this)

