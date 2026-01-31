-- Migration: Drop unused tables (automation uses backend 'strategies' table, not these).
-- Run this in Supabase SQL Editor if you already have automation_scripts/script_executions.

-- Drop in order (script_executions references automation_scripts)
DROP POLICY IF EXISTS "Users can view own script executions" ON script_executions;
DROP POLICY IF EXISTS "Users can insert own script executions" ON script_executions;
DROP TABLE IF EXISTS script_executions;

DROP POLICY IF EXISTS "Users can view own scripts" ON automation_scripts;
DROP POLICY IF EXISTS "Users can insert own scripts" ON automation_scripts;
DROP POLICY IF EXISTS "Users can update own scripts" ON automation_scripts;
DROP POLICY IF EXISTS "Users can delete own scripts" ON automation_scripts;
DROP TRIGGER IF EXISTS update_automation_scripts_updated_at ON automation_scripts;
DROP TABLE IF EXISTS automation_scripts;
