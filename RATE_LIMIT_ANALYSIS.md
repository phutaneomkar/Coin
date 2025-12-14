# Rate Limit Analysis & Solutions

## 🔴 Reasons Why Rate Limits Are Being Hit

### 1. **Rate Limiter Not Persisting Across Requests**
   - **Problem**: In Next.js serverless functions, each API route invocation may run in a separate process/container
   - **Impact**: The rate limiter singleton doesn't share state across different serverless instances
   - **Result**: Multiple requests can pass the rate limit check simultaneously

### 2. **Multiple Simultaneous API Calls**
   - **Dashboard Page**: Calls `/api/crypto/prices` on load
   - **Coin Detail Page**: Calls `/api/crypto/coin-detail` when opened
   - **Chart Component**: Calls `/api/crypto/chart` when timeframe changes
   - **Problem**: If user navigates quickly, 3+ API calls happen within seconds
   - **Result**: All calls check rate limiter at same time → all pass → all hit CoinGecko

### 3. **Client-Side Caching Not Effective**
   - **Problem**: `next: { revalidate: 300 }` in client-side `fetch()` doesn't work like server-side caching
   - **Impact**: Each component makes its own fetch, bypassing cache
   - **Result**: Multiple components = multiple API calls

### 4. **No Request Queuing**
   - **Problem**: When rate limit is hit, requests fail immediately instead of queuing
   - **Impact**: User retries quickly → more requests → worse rate limiting

### 5. **React Strict Mode Double Rendering**
   - **Problem**: In development, React Strict Mode causes `useEffect` to run twice
   - **Impact**: API calls happen twice on page load
   - **Result**: 2x the API calls in development

### 6. **Chart Component Refetching on Timeframe Change**
   - **Problem**: Every timeframe change triggers a new API call
   - **Impact**: User switching timeframes quickly = multiple rapid API calls
   - **Result**: Rate limit hit quickly

## ✅ Solutions & Recommendations

### **Solution 1: Use Shared Cache/Storage for Rate Limiter** ⭐ RECOMMENDED
   - Use Redis or a shared database to track rate limits across all serverless instances
   - Or use Next.js Edge Config or Vercel KV for shared state
   - **Benefit**: True rate limiting across all requests

### **Solution 2: Implement Request Queuing** ⭐ RECOMMENDED
   - Queue requests when rate limit is hit
   - Wait and retry automatically after delay
   - **Benefit**: Better user experience, fewer failed requests

### **Solution 3: Increase Cache Duration** ⭐ EASY FIX
   - Increase cache from 5 minutes to 10-15 minutes
   - Use stale-while-revalidate pattern more aggressively
   - **Benefit**: Fewer API calls overall

### **Solution 4: Debounce Chart Timeframe Changes**
   - Add 500ms debounce to timeframe selector
   - Prevent rapid API calls when user clicks multiple timeframes
   - **Benefit**: Reduces unnecessary chart API calls

### **Solution 5: Use SWR or React Query**
   - Implement proper client-side caching with SWR/React Query
   - Automatic deduplication of requests
   - **Benefit**: Multiple components can share same cached data

### **Solution 6: Reduce Refresh Frequency**
   - Increase dashboard refresh from 5 minutes to 10 minutes
   - Remove automatic refresh on coin detail page (already done)
   - **Benefit**: Fewer background API calls

### **Solution 7: Batch API Calls**
   - Combine coin detail + chart data in single API call
   - Use CoinGecko's batch endpoints if available
   - **Benefit**: 1 API call instead of 2

### **Solution 8: Add Request Deduplication**
   - Track in-flight requests
   - If same request is already in progress, wait for it instead of making new call
   - **Benefit**: Prevents duplicate simultaneous requests

## 🎯 Immediate Actions (Quick Fixes)

1. ✅ **Increase cache duration to 10 minutes** - DONE
2. ✅ **Add debounce to chart timeframe selector** - DONE (500ms)
3. ✅ **Increase dashboard refresh to 10 minutes** - DONE
4. ✅ **Add request deduplication** - DONE
5. ✅ **Reduce coins to 200** - DONE
6. ✅ **Reduce rate limit to 20 calls/minute** - DONE
7. ✅ **Remove auto-refresh on coin detail** - DONE

## 📊 Current API Call Pattern

**Per User Session:**
- Dashboard load: 1 call (prices)
- Open coin detail: 1 call (coin-detail)
- Load chart: 1 call (chart)
- Change timeframe: 1 call per change (chart)
- **Total**: 3-5+ calls per user session

**With Multiple Users:**
- Each user = 3-5 calls
- 10 users = 30-50 calls/minute
- **Result**: Rate limit exceeded

## 💡 Best Solution: Implement SWR + Increase Caching

This will:
- ✅ Deduplicate requests automatically
- ✅ Share cache across components
- ✅ Reduce API calls by 70-80%
- ✅ Better user experience

