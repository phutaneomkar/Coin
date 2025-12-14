# Database Setup Guide

## The Problem

You're getting 404 errors because the database tables don't exist in Supabase yet. The schema needs to be applied.

## Solution: Apply the Database Schema

### Step 1: Open Supabase Dashboard
1. Go to: https://supabase.com/dashboard
2. Select your project

### Step 2: Open SQL Editor
1. Click **"SQL Editor"** in the left sidebar
2. Click **"New query"**

### Step 3: Copy and Run Schema
1. Open `frontend/supabase/schema.sql` in your project
2. **Copy ALL the SQL code** (the entire file)
3. Paste it into the Supabase SQL Editor
4. Click **"Run"** (or press Ctrl+Enter)
5. Wait for "Success" message

### Step 4: Verify Tables Were Created
1. Go to **"Table Editor"** in the left sidebar
2. You should see these tables:
   - ✅ `profiles`
   - ✅ `watchlist`
   - ✅ `orders`
   - ✅ `holdings`
   - ✅ `transactions`
   - ✅ `automation_scripts`
   - ✅ `script_executions`

## Quick Check

After applying the schema, refresh your app. The 404 errors should be gone.

## Troubleshooting

### If you get "relation already exists" errors:
- Some tables might already exist
- This is OK - the `IF NOT EXISTS` clause will skip them
- Continue running the rest of the schema

### If you get permission errors:
- Make sure you're logged into Supabase
- Check that you have access to the project

### If tables still don't appear:
- Check the SQL Editor for any error messages
- Make sure you copied the ENTIRE schema.sql file
- Try running it section by section if needed
