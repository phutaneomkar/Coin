
'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'react-hot-toast';

const CHECK_INTERVAL_MS = 15000;
const BACKOFF_MAX_MS = 60000; // When API fails, back off up to 1 min

export function LimitOrderChecker() {
    const lastCheckTime = useRef<number>(0);
    const intervalMs = useRef<number>(CHECK_INTERVAL_MS);

    useEffect(() => {
        const checkLimits = async () => {
            const now = Date.now();
            if (now - lastCheckTime.current < 10000) return;
            lastCheckTime.current = now;

            try {
                const res = await fetch('/api/orders/check-limits', { method: 'GET' });
                if (res.ok) {
                    intervalMs.current = CHECK_INTERVAL_MS; // Reset backoff on success
                    const data = await res.json();
                    if (data.success && data.executed > 0) {
                        toast.success(`Limit Order Executed! (${data.executed} orders filled)`, {
                            duration: 5000,
                            icon: '🚀'
                        });
                    }
                } else {
                    // Back off on error (e.g. 500 or DB unavailable)
                    intervalMs.current = Math.min(intervalMs.current * 1.5, BACKOFF_MAX_MS);
                }
            } catch {
                intervalMs.current = Math.min(intervalMs.current * 1.5, BACKOFF_MAX_MS);
            }
        };

        const timeoutRef = { current: null as ReturnType<typeof setTimeout> | null };
        const schedule = () => {
            timeoutRef.current = setTimeout(() => {
                checkLimits();
                schedule();
            }, intervalMs.current);
        };
        const initialTimeout = setTimeout(() => {
            checkLimits();
            schedule();
        }, 2000);

        return () => {
            clearTimeout(initialTimeout);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    return null;
}
