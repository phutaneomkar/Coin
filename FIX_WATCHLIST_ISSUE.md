# Fix Watchlist Issue - Add INSERT Policy

## The Problem

Users can't add coins to watchlist because:
1. Profile doesn't exist (trigger might not have run)
2. No INSERT policy on profiles table (RLS blocking profile creation)

## Solution

### Step 1: Add INSERT Policy to Profiles Table

Go to Supabase Dashboard → SQL Editor and run:

```sql
-- Allow users to insert their own profile
CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);
```

### Step 2: Verify Profile Exists

Check if your profile exists:
1. Go to Supabase Dashboard → Table Editor → `profiles`
2. Look for your user ID
3. If missing, it will be created automatically when you try to add to watchlist

### Step 3: Test Watchlist

After adding the policy:
1. Refresh your app
2. Try adding a coin to watchlist
3. It should work now!

## Alternative: Manual Profile Creation

If the policy doesn't work, you can manually create your profile:

1. Go to Supabase Dashboard → Table Editor → `profiles`
2. Click "Insert row"
3. Fill in:
   - `id`: Your user ID (from auth.users table)
   - `email`: Your email
   - `balance_inr`: 0
   - `kyc_status`: 'pending'
4. Click "Save"

## Verify RLS Policies

Make sure these policies exist on `profiles` table:
- ✅ SELECT: Users can view own profile
- ✅ INSERT: Users can insert own profile (NEW - add this!)
- ✅ UPDATE: Users can update own profile
