# Render Quick Start Checklist

Follow these steps in order to deploy your application to Render.

## ✅ Pre-Deployment Checklist

- [ ] Code is pushed to GitHub
- [ ] You have a Render account (sign up at render.com)
- [ ] You have Supabase database URL
- [ ] You have Supabase project URL and anon key
- [ ] (Optional) You have COINDCX API keys

---

## 🚀 Deployment Steps

### Step 1: Connect Repository to Render

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"Blueprint"**
3. Connect your GitHub account
4. Select your repository
5. Render will automatically detect `render.yaml`

### Step 2: Configure Backend Environment Variables

After services are created, go to **crypto-backend** service → **Environment** tab:

- [ ] Add `DATABASE_URL` = Your Supabase PostgreSQL connection string

**Get DATABASE_URL from Supabase:**
1. Supabase Dashboard → Your Project → Settings → Database
2. Under "Connection string" → "URI" → Copy the connection string
3. Format: `postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`

### Step 3: Configure Frontend Environment Variables

Go to **coin-frontend** service → **Environment** tab:

- [ ] `BACKEND_URL` - Will be auto-set from backend service URL
- [ ] Add `NEXT_PUBLIC_SUPABASE_URL` = Your Supabase project URL (e.g., `https://xxxxx.supabase.co`)
- [ ] Add `NEXT_PUBLIC_SUPABASE_ANON_KEY` = Your Supabase anon key
- [ ] Add `COINDCX_API_URL` = `https://api.coindcx.com` (already in render.yaml)
- [ ] (Optional) Add `COINDCX_API_KEY` = Your COINDCX API key
- [ ] (Optional) Add `COINDCX_API_SECRET` = Your COINDCX API secret

**Get Supabase credentials:**
1. Supabase Dashboard → Your Project → Settings → API
2. Copy "Project URL" → Use for `NEXT_PUBLIC_SUPABASE_URL`
3. Copy "anon public" key → Use for `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Step 4: Deploy Services

1. Services will auto-deploy when you push to `main` branch
2. Or click **"Manual Deploy"** → **"Deploy latest commit"** in each service

### Step 5: Wait for Deployment

- **Backend**: First build takes 5-10 minutes (compiling Rust)
- **Frontend**: Build takes 2-5 minutes

### Step 6: Verify Deployment

**Test Backend:**
```
Visit: https://crypto-backend-xxxx.onrender.com/health
Expected: Should return "OK"
```

**Test Frontend:**
```
Visit: https://coin-frontend-xxxx.onrender.com
Expected: Your application should load
```

---

## 🔗 Service URLs

After deployment, your URLs will be:

- **Backend**: `https://crypto-backend-xxxx.onrender.com`
- **Frontend**: `https://coin-frontend-xxxx.onrender.com`

Replace `xxxx` with your unique service ID.

---

## ⚠️ Important Notes

1. **Free Tier Sleep Mode**: Services sleep after 15 minutes of inactivity
   - First request after sleep: 30-60 seconds wake-up time
   - Consider upgrading to paid plan for production

2. **Environment Variables**: 
   - Must be set in Render dashboard
   - Restart service after adding new variables

3. **Build Time**: First build is slowest (especially Rust backend)
   - Subsequent builds are faster

4. **Backend URL**: The frontend automatically gets backend URL from `render.yaml`
   - But you can manually set `BACKEND_URL` if needed

---

## 🐛 Troubleshooting

### Backend won't start
- Check `DATABASE_URL` is set correctly
- Verify database is accessible (Supabase allows connections from anywhere by default)
- Check service logs in Render dashboard

### Frontend shows errors
- Verify all environment variables are set
- Check that `BACKEND_URL` points to your backend service
- Check browser console for errors

### CORS errors
- Backend already allows all origins
- If issues persist, check backend logs

---

## 📚 Full Documentation

See `RENDER_SETUP.md` for detailed documentation and advanced configuration.






