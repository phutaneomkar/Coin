import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        // Ideally we should filter by user here in the future
        const baseUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001';
        const url = `${baseUrl}/api/automation/strategies`;
        
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
            if (res.status === 502) {
                console.error(`[Automation Strategies] Backend returned 502. URL: ${url}`);
                return NextResponse.json(
                    { error: 'Backend service unavailable', message: 'The backend service is not responding. Please check if the backend is running.' },
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
        console.error("[Automation Strategies] Proxy Error connecting to Backend:", error);
        console.error("[Automation Strategies] Target URL was:", process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001');
        console.error("[Automation Strategies] Error details:", error.message);
        
        // Return 502 if it's a connection error
        if (error.message?.includes('fetch') || error.message?.includes('ECONNREFUSED') || error.message?.includes('ENOTFOUND')) {
            return NextResponse.json(
                { error: 'Backend connection failed', message: 'Unable to connect to backend service. Please check if the backend is running and BACKEND_URL is correctly configured.' },
                { status: 502 }
            );
        }
        
        return NextResponse.json(
            { error: 'Internal server error', message: error.message },
            { status: 500 }
        );
    }
}
