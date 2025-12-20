# Render Deployment Guide

This guide will walk you through deploying both the frontend and backend of your cryptocurrency dashboard on Render.

## Prerequisites

1. **Render Account**: Sign up at [render.com](https://render.com) (free tier available)
2. **GitHub Repository**: Push your code to GitHub
3. **Supabase Database**: Have your Supabase database URL ready
4. **COINDCX API Keys**: If using production API

## Overview

You'll deploy two services on Render:
1. **Backend**: Rust API (Docker-based)
2. **Frontend**: Next.js application

---

## Step 1: Push Code to GitHub

First, ensure your code is pushed to a GitHub repository:

```bash
git add .
git commit -m "Prepare for Render deployment"
git push origin main
```

---

## Step 2: Deploy Backend (Rust API)

### Option A: Using render.yaml (Recommended - Automatic Setup)

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"Blueprint"** (Infrastructure as Code)
3. Connect your GitHub repository
4. Select your repository
5. Render will automatically detect `render.yaml` and create both services
6. You'll need to set environment variables (see Step 4)

### Option B: Manual Setup

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure the service:
   - **Name**: `crypto-backend`
   - **Environment**: `Docker`
   - **Region**: Choose closest to you (e.g., `Oregon (US West)`)
   - **Branch**: `main`
   - **Root Directory**: `backend`
   - **Build Command**: (leave empty - Docker handles it)
   - **Start Command**: (leave empty - Dockerfile handles it)
   - **Plan**: `Free` (or choose a paid plan)

5. **Set Environment Variables** (see Step 4 below)

---

## Step 3: Deploy Frontend (Next.js)

### If using render.yaml (Option A):
The frontend service will be automatically created.

### If Manual Setup (Option B):
1. In Render Dashboard, click **"New +"** → **"Web Service"**
2. Connect the same GitHub repository
3. Configure the service:
   - **Name**: `coin-frontend`
   - **Environment**: `Node`
   - **Region**: Same as backend
   - **Branch**: `main`
   - **Root Directory**: `frontend`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: `Free` (or choose a paid plan)

4. **Set Environment Variables** (see Step 4 below)

---

## Step 4: Configure Environment Variables

### Backend Environment Variables

In the backend service settings, add:

| Key | Value | Notes |
|-----|-------|-------|
| `DATABASE_URL` | `postgresql://...` | Your Supabase connection string |
| `PORT` | (auto-set by Render) | Render sets this automatically, but you can override |

**To get DATABASE_URL from Supabase:**
1. Go to your Supabase project
2. Settings → Database
3. Copy the "Connection string" under "Connection pooling" or "Direct connection"
4. Format: `postgresql://postgres:[YOUR-PASSWORD]@[HOST]:5432/postgres`

### Frontend Environment Variables

In the frontend service settings, add:

| Key | Value | Notes |
|-----|-------|-------|
| `BACKEND_URL` | `https://crypto-backend-[hash].onrender.com` | Your backend URL (get after backend deploys) |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGci...` | Your Supabase anon key |
| `COINDCX_API_URL` | `https://api.coindcx.com` | (Optional) COINDCX API URL |
| `COINDCX_API_KEY` | `your_key` | (Optional) Your COINDCX API key |
| `COINDCX_API_SECRET` | `your_secret` | (Optional) Your COINDCX API secret |

**Important Notes:**
- Set `BACKEND_URL` after the backend service is deployed and you have its URL
- The backend URL will be in the format: `https://crypto-backend-xxxx.onrender.com`
- You can find backend URL in the backend service dashboard

---

## Step 5: Deployment Process

### Backend Deployment:
1. Render will build the Docker image (this takes 5-10 minutes for first build)
2. The build process:
   - Uses Rust latest stable version (supports newer dependencies)
   - Compiles your Rust code
   - Creates optimized binary
3. Service will start automatically after build

**Note**: The Dockerfile uses `rust:latest` to ensure compatibility with all dependencies. If you encounter build errors related to Rust version, you may need to update the Dockerfile to use a specific Rust version.

### Frontend Deployment:
1. Render installs Node.js dependencies
2. Runs `npm run build`
3. Starts the Next.js production server
4. Service will be available at `https://coin-frontend-xxxx.onrender.com`

---

## Step 6: Update CORS Settings (if needed)

If you encounter CORS errors, the backend already allows all origins in `backend/src/main.rs`. If you want to restrict it to your frontend URL:

```rust
// In backend/src/main.rs, replace:
.allow_origin(Any)

// With:
.allow_origin("https://coin-frontend-xxxx.onrender.com".parse::<HeaderValue>().unwrap())
```

---

## Step 7: Health Check

Verify both services are running:

1. **Backend Health Check**: 
   - Visit: `https://crypto-backend-xxxx.onrender.com/health`
   - Should return: `OK`

2. **Frontend**: 
   - Visit: `https://coin-frontend-xxxx.onrender.com`
   - Should load your application

---

## Troubleshooting

### Backend Issues

**Problem**: Backend build fails
- **Solution**: Check build logs in Render dashboard. Common issues:
  - Missing dependencies in `Cargo.toml`
  - Rust compilation errors
  - Database connection issues
  - **Rust version errors** (e.g., "edition2024 is required"): The Dockerfile uses `rust:latest` to support newer dependencies. If you still get version errors, you may need to update dependencies in `Cargo.toml` to versions compatible with stable Rust.

**Problem**: Backend crashes on startup
- **Solution**: 
  - Check that `DATABASE_URL` is set correctly
  - Verify database is accessible from Render's IP
  - Check logs for specific error messages

**Problem**: Backend times out
- **Solution**: 
  - Free tier services sleep after 15 minutes of inactivity
  - First request after sleep can take 30-60 seconds
  - Consider upgrading to a paid plan for always-on service

### Frontend Issues

**Problem**: Frontend can't connect to backend
- **Solution**: 
  - Verify `BACKEND_URL` is set correctly
  - Check that backend service is running
  - Ensure backend URL uses `https://` not `http://`

**Problem**: Build fails
- **Solution**: 
  - Check that all environment variables are set
  - Verify Node.js version compatibility
  - Check build logs for specific errors

**Problem**: Environment variables not working
- **Solution**: 
  - Variables starting with `NEXT_PUBLIC_` are exposed to browser
  - Regular variables are server-side only
  - Restart service after adding new variables

---

## Free Tier Limitations

⚠️ **Important**: Render's free tier has limitations:

1. **Sleep Mode**: Services sleep after 15 minutes of inactivity
   - First request after sleep takes 30-60 seconds to wake up
   - Consider upgrading to paid plan for production

2. **Build Time**: Free tier has longer build times (5-10 minutes)

3. **Resource Limits**: Limited CPU and memory

4. **Bandwidth**: Limited monthly bandwidth

---

## Production Recommendations

For production use, consider:

1. **Upgrade to Paid Plans**: 
   - Backend: Starter plan ($7/month) - always-on
   - Frontend: Starter plan ($7/month) - always-on

2. **Database**: 
   - Use Supabase paid plan for better performance
   - Or use Render's PostgreSQL (paid)

3. **Monitoring**: 
   - Set up alerts in Render dashboard
   - Monitor logs regularly

4. **Custom Domains**: 
   - Add custom domains in Render settings
   - Set up SSL certificates (Render provides free SSL)

---

## Quick Reference: Service URLs

After deployment, you'll have:

- **Backend**: `https://crypto-backend-xxxx.onrender.com`
- **Frontend**: `https://coin-frontend-xxxx.onrender.com`

Replace `xxxx` with your unique service identifier.

---

## Next Steps

1. Test all functionality in production
2. Set up monitoring and alerts
3. Configure custom domains (optional)
4. Set up CI/CD for automatic deployments on git push

---

## Need Help?

- Render Documentation: https://render.com/docs
- Render Community: https://community.render.com
- Check service logs in Render dashboard for detailed error messages

