/**
 * Request deduplicator to prevent multiple identical API calls
 * If the same request is already in progress, wait for it instead of making a new call
 */

interface PendingRequest {
  promise: Promise<any>;
  timestamp: number;
}

class RequestDeduplicator {
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private readonly maxAge = 30000; // 30 seconds - requests older than this are considered stale

  /**
   * Get or create a request
   * @param key Unique key for the request (e.g., URL)
   * @param requestFn Function that makes the actual request
   * @returns Promise that resolves with the request result
   */
  async get<T>(key: string, requestFn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    
    // Clean up stale requests
    for (const [k, req] of this.pendingRequests.entries()) {
      if (now - req.timestamp > this.maxAge) {
        this.pendingRequests.delete(k);
      }
    }

    // Check if request is already in progress
    const existing = this.pendingRequests.get(key);
    if (existing && (now - existing.timestamp) < this.maxAge) {
      return existing.promise;
    }

    // Create new request
    const promise = requestFn().finally(() => {
      // Remove from pending after completion (with small delay to allow concurrent requests to catch it)
      setTimeout(() => {
        this.pendingRequests.delete(key);
      }, 100);
    });

    this.pendingRequests.set(key, {
      promise,
      timestamp: now,
    });

    return promise;
  }

  /**
   * Clear all pending requests
   */
  clear() {
    this.pendingRequests.clear();
  }
}

// Singleton instance
export const requestDeduplicator = new RequestDeduplicator();

