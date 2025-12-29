import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        // Ideally we should filter by user here in the future
        // Smart URL resolution: In development, prefer NEXT_PUBLIC_API_URL if BACKEND_URL has wrong port
        const isDevelopment = process.env.NODE_ENV === 'development';
        let baseUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:3001';
        
        // In development, if BACKEND_URL points to wrong port (3002), prefer NEXT_PUBLIC_API_URL
        if (isDevelopment && process.env.BACKEND_URL) {
            const backendUrl = process.env.BACKEND_URL;
            const hasWrongPort = backendUrl.includes(':3002') || backendUrl.includes('localhost:3002');
            if (hasWrongPort && process.env.NEXT_PUBLIC_API_URL) {
                const correctUrl = process.env.NEXT_PUBLIC_API_URL;
                console.warn(`[Automation Strategies] BACKEND_URL has wrong port (3002), using NEXT_PUBLIC_API_URL instead: ${correctUrl}`);
                baseUrl = correctUrl;
            }
        }
        const url = `${baseUrl}/api/automation/strategies`;
        
        // Debug logging to help identify which env var is being used
        console.log(`[Automation Strategies] Environment check:`, {
            BACKEND_URL: process.env.BACKEND_URL || 'NOT SET',
            NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'NOT SET',
            NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL || 'NOT SET',
            resolvedUrl: baseUrl,
            nodeEnv: process.env.NODE_ENV,
        });
        
        // First, check database health
        const dbHealthUrl = `${baseUrl}/health/db`;
        let dbHealthStatus = 'unknown';
        let healthTimeout: NodeJS.Timeout | null = null;
        try {
            const healthController = new AbortController();
            healthTimeout = setTimeout(() => healthController.abort(), 5000);
            const healthRes = await fetch(dbHealthUrl, {
                cache: 'no-store',
                signal: healthController.signal,
            });
            if (healthTimeout) clearTimeout(healthTimeout);
            if (healthRes.ok) {
                const healthData = await healthRes.json();
                dbHealthStatus = healthData.status || 'unknown';
                console.log(`[Automation Strategies] Database health:`, healthData);
            } else {
                const healthText = await healthRes.text();
                console.error(`[Automation Strategies] Database health check failed: ${healthRes.status} - ${healthText}`);
                dbHealthStatus = 'unhealthy';
            }
        } catch (healthError: any) {
            if (healthTimeout) clearTimeout(healthTimeout);
            if (healthError.name === 'AbortError') {
                console.warn(`[Automation Strategies] Database health check timed out`);
                dbHealthStatus = 'timeout';
            } else {
                console.warn(`[Automation Strategies] Could not check database health:`, healthError.message);
                dbHealthStatus = 'check_failed';
            }
        }
        
        console.log(`[Automation Strategies] Fetching from: ${url}`);
        
        // Add timeout to prevent hanging requests
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        try {
            const res = await fetch(url, { 
                cache: 'no-store',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            
            clearTimeout(timeoutId);

            // Handle 502 Bad Gateway specifically
            if (res.status === 502 || !res.ok) {
                const errorText = await res.text().catch(() => 'Unable to read error response');
                console.error(`[Automation Strategies] Backend returned ${res.status}. URL: ${url}`);
                console.error(`[Automation Strategies] Error response: ${errorText.substring(0, 200)}`);
                console.error(`[Automation Strategies] Database health status: ${dbHealthStatus}`);
                
                let errorMessage = `Backend returned ${res.status}.`;
                if (dbHealthStatus === 'unhealthy' || dbHealthStatus === 'check_failed') {
                    errorMessage += ' Database connection may be failing. Check backend logs in Render dashboard.';
                } else if (dbHealthStatus === 'healthy') {
                    errorMessage += ' Backend is reachable but endpoint failed. Check backend logs.';
                } else {
                    errorMessage += ' The backend service may be down, sleeping (free tier), or the BACKEND_URL is incorrect.';
                }
                
                return NextResponse.json(
                    { 
                        error: 'Backend service unavailable', 
                        message: errorMessage,
                        debug: {
                            backendUrl: baseUrl,
                            status: res.status,
                            errorResponse: errorText.substring(0, 200),
                            databaseHealth: dbHealthStatus,
                        }
                    },
                    { status: 502 }
                );
            }

            const contentType = res.headers.get("content-type");
            let data;
            if (contentType && contentType.includes("application/json")) {
                data = await res.json();
            } else {
                const text = await res.text();
                try {
                    data = JSON.parse(text);
                } catch {
                    data = { message: text || res.statusText };
                }
            }

            return NextResponse.json(data, { status: res.status });
        } catch (fetchError: any) {
            clearTimeout(timeoutId);
            if (fetchError.name === 'AbortError') {
                console.error(`[Automation Strategies] Request timeout after 10s. URL: ${url}`);
                return NextResponse.json(
                    { error: 'Request timeout', message: 'Backend service did not respond in time' },
                    { status: 504 }
                );
            }
            throw fetchError;
        }
    } catch (error: any) {
        const attemptedUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:3001';
        
        console.error("[Automation Strategies] Proxy Error connecting to Backend:", error);
        console.error("[Automation Strategies] Error name:", error.name);
        console.error("[Automation Strategies] Error code:", error.code);
        console.error("[Automation Strategies] Error message:", error.message);
        console.error("[Automation Strategies] Attempted URL:", attemptedUrl);
        console.error("[Automation Strategies] Environment variables:", {
            BACKEND_URL: process.env.BACKEND_URL || 'NOT SET',
            NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'NOT SET',
            NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL || 'NOT SET',
            NODE_ENV: process.env.NODE_ENV,
        });
        
        // Return 502 if it's a connection error
        const isConnectionError = 
            error.message?.includes('fetch') || 
            error.message?.includes('ECONNREFUSED') || 
            error.message?.includes('ENOTFOUND') ||
            error.code === 'ECONNREFUSED' ||
            error.code === 'ENOTFOUND';
        
        if (isConnectionError) {
            // Check if it's a port mismatch issue
            const portMismatch = attemptedUrl.includes(':3002');
            const hasCorrectUrl = process.env.NEXT_PUBLIC_API_URL && process.env.NEXT_PUBLIC_API_URL.includes(':3001');
            
            let errorMessage = `Unable to connect to backend at ${attemptedUrl}.`;
            let fixHint = '';
            
            if (portMismatch) {
                errorMessage = `Backend connection failed: Trying to connect to port 3002, but backend runs on port 3001.`;
                if (hasCorrectUrl) {
                    fixHint = `Your NEXT_PUBLIC_API_URL (${process.env.NEXT_PUBLIC_API_URL}) has the correct port. Fix your .env.local file:\n1. Remove or comment out BACKEND_URL=http://127.0.0.1:3002\n2. Or change it to: BACKEND_URL=http://127.0.0.1:3001\n3. Restart your Next.js dev server`;
                } else {
                    fixHint = `Fix your .env.local file:\n1. Set BACKEND_URL=http://127.0.0.1:3001 (not 3002)\n2. Or remove BACKEND_URL to use the default\n3. Restart your Next.js dev server`;
                }
            } else {
                fixHint = 'Make sure the backend is running: cd backend && cargo run';
            }
            
            return NextResponse.json(
                { 
                    error: 'Backend connection failed', 
                    message: errorMessage,
                    fix: fixHint,
                    debug: {
                        attemptedUrl,
                        errorCode: error.code,
                        errorMessage: error.message,
                        envVars: {
                            BACKEND_URL: process.env.BACKEND_URL || 'NOT SET',
                            NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'NOT SET',
                            NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL || 'NOT SET',
                        },
                        hint: portMismatch ? 'Backend should run on port 3001. Check your .env.local file.' : 'Ensure backend is running: cd backend && cargo run',
                    }
                },
                { status: 502 }
            );
        }
        
        return NextResponse.json(
            { error: 'Internal server error', message: error.message },
            { status: 500 }
        );
    }
}
