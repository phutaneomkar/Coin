/**
 * Rate limiter to ensure we stay within CoinGecko's free tier limit
 * Free tier: ~30 calls per minute
 */

class RateLimiter {
  private requests: number[] = [];
  private lastRequestTime: number = 0;
  private readonly maxRequests = 15; // Reduced to 15 calls/minute for safety
  private readonly windowMs = 60000; // 1 minute window
  private readonly minDelayMs = 4000; // Minimum 4 seconds between requests

  /**
   * Check if we can make a request, and record it if we do
   * @returns true if request can be made, false if rate limited
   */
  canMakeRequest(): boolean {
    const now = Date.now();
    
    // Enforce minimum delay between requests
    if (now - this.lastRequestTime < this.minDelayMs) {
      return false;
    }
    
    // Remove requests older than 1 minute
    this.requests = this.requests.filter(
      (timestamp) => now - timestamp < this.windowMs
    );

    // Check if we're under the limit
    if (this.requests.length < this.maxRequests) {
      this.requests.push(now);
      this.lastRequestTime = now;
      return true;
    }

    return false;
  }

  /**
   * Get the time to wait before next request can be made (in milliseconds)
   */
  getWaitTime(): number {
    if (this.requests.length === 0) return 0;
    
    const oldestRequest = Math.min(...this.requests);
    const waitTime = this.windowMs - (Date.now() - oldestRequest);
    
    return Math.max(0, waitTime);
  }

  /**
   * Get current request count in the window
   */
  getCurrentCount(): number {
    const now = Date.now();
    this.requests = this.requests.filter(
      (timestamp) => now - timestamp < this.windowMs
    );
    return this.requests.length;
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();
