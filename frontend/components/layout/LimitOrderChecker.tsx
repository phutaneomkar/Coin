
'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'react-hot-toast';

export function LimitOrderChecker() {
    const lastCheckTime = useRef<number>(0);

    useEffect(() => {
        // Check limit orders every 15 seconds
        const checkLimits = async () => {
            // Prevent double firing in strict mode or frequent re-renders
            const now = Date.now();
            if (now - lastCheckTime.current < 10000) return;
            lastCheckTime.current = now;

            try {
                const res = await fetch('/api/orders/check-limits', { method: 'GET' });
                if (!res.ok) return; // Silent fail on error

                const data = await res.json();

                if (data.success && data.executed > 0) {
                    // Notify user of execution
                    toast.success(`Limit Order Executed! (${data.executed} orders filled)`, {
                        duration: 5000,
                        icon: '🚀'
                    });
                    // Play a sound? Maybe later.
                }

                // If logs present and debug mode enabled (optional), we could show them.
                // For now, keep console clean unless error.
            } catch (error) {
                console.error('Global limit check error:', error);
            }
        };

        // Initial check after 2 seconds
        const timeout = setTimeout(checkLimits, 2000);

        // Interval
        const interval = setInterval(checkLimits, 15000);

        return () => {
            clearTimeout(timeout);
            clearInterval(interval);
        };
    }, []);

    return null; // Renderless component
}
