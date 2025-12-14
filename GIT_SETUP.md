# Git Setup Guide - Protecting Sensitive Data

This guide will help you safely push your code to Git while protecting sensitive information.

## ✅ What's Already Protected

The `.gitignore` file has been configured to exclude:
- All `.env` files (environment variables)
- API keys and credentials
- Build artifacts
- Node modules
- Rust target directory
- IDE files
- OS files

## 📋 Steps to Push to Git

### 1. Initialize Git Repository (if not already done)

```bash
cd d:\Personal\Coin
git init
```

### 2. Check What Will Be Committed

```bash
git status
```

This will show you all files that will be tracked. Make sure `.env` files are NOT listed.

### 3. If `.env` Files Are Already Tracked

If you see `.env` files in `git status`, they were previously committed. Remove them from tracking:

```bash
# Remove from Git tracking (but keep local files)
git rm --cached frontend/.env
git rm --cached backend/.env
git rm --cached .env
git rm --cached "**/.env*"

# Commit the removal
git commit -m "Remove sensitive .env files from tracking"
```

### 4. Add All Files (except those in .gitignore)

```bash
git add .
```

### 5. Verify Sensitive Files Are NOT Included

```bash
git status
```

Double-check that no `.env` files appear in the list.

### 6. Create Initial Commit

```bash
git commit -m "Initial commit: Cryptocurrency trading platform"
```

### 7. Add Remote Repository

```bash
# Replace with your actual repository URL
git remote add origin https://github.com/yourusername/your-repo.git
```

### 8. Push to Remote

```bash
git branch -M main
git push -u origin main
```

## 🔒 Environment Variables Setup

### For New Developers/Deployments

1. **Frontend**: Copy `frontend/.env.example` to `frontend/.env.local`
2. **Backend**: Copy `backend/.env.example` to `backend/.env`

Then fill in the actual values from your Supabase/API accounts.

## ⚠️ Important Security Notes

1. **Never commit `.env` files** - They contain sensitive API keys and database credentials
2. **Never commit real credentials** to `.env.example` - Use placeholders
3. **Review before pushing** - Always run `git status` before committing
4. **If you accidentally commit secrets**:
   - Rotate/regenerate all exposed API keys immediately
   - Remove from Git history (requires force push - be careful!)
   - Consider using Git secrets scanning tools

## 📝 Files That Should Be Committed

✅ Source code (`.ts`, `.tsx`, `.rs`, etc.)
✅ Configuration files (`.toml`, `package.json`, etc.)
✅ Documentation (`.md` files)
✅ `.gitignore`
✅ `.env.example` files (templates only)

## 🚫 Files That Should NOT Be Committed

❌ `.env` and `.env.local` files
❌ `node_modules/`
❌ `backend/target/` (Rust build artifacts)
❌ `.next/` (Next.js build output)
❌ API keys, secrets, credentials
❌ Database connection strings with passwords

## 🔍 Verify Before Pushing

Run this command to check for any sensitive data:

```bash
# Check for common secrets patterns
git diff --cached | grep -i "password\|secret\|key\|token" | grep -v "example\|placeholder\|your_"
```

If you see any matches, review them carefully before committing.
