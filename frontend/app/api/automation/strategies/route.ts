import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        // Ideally we should filter by user here in the future
        // Priority: BACKEND_URL > NEXT_PUBLIC_API_URL > default localhost:3001
        const baseUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:3001';
        const url = `${baseUrl}/api/automation/strategies`;
        
        // Debug logging to help identify which env var is being used
        console.log(`[Automation Strategies] Environment check:`, {
            BACKEND_URL: process.env.BACKEND_URL || 'NOT SET',
            NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'NOT SET',
            NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL || 'NOT SET',
            resolvedUrl: baseUrl,
            nodeEnv: process.env.NODE_ENV,
        });
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
                
                return NextResponse.json(
                    { 
                        error: 'Backend service unavailable', 
                        message: `Backend returned ${res.status}. The backend service may be down, sleeping (free tier), or the BACKEND_URL is incorrect. Check Render dashboard → crypto-backend service status.`,
                        debug: {
                            backendUrl: baseUrl,
                            status: res.status,
                            errorResponse: errorText.substring(0, 200),
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
            const portMismatch = attemptedUrl.includes(':3002') && error.code === 'ECONNREFUSED';
            const errorMessage = portMismatch
                ? `Backend connection failed: Trying to connect to port 3002, but backend runs on port 3001. Please check your .env.local file - set BACKEND_URL=http://127.0.0.1:3001 or remove the incorrect environment variable.`
                : `Unable to connect to backend at ${attemptedUrl}. Make sure the backend is running on the correct port (default: 3001).`;
            
            return NextResponse.json(
                { 
                    error: 'Backend connection failed', 
                    message: errorMessage,
                    debug: {
                        attemptedUrl,
                        errorCode: error.code,
                        errorMessage: error.message,
                        hint: portMismatch ? 'Backend should run on port 3001. Check your .env.local file for incorrect BACKEND_URL or NEXT_PUBLIC_API_URL values.' : 'Ensure backend is running: cd backend && cargo run',
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
