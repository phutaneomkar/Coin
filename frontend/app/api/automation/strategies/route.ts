import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        // Ideally we should filter by user here in the future
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001';
        const res = await fetch(`${baseUrl}/api/automation/strategies`, { cache: 'no-store' });

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
    } catch (error: any) {
        console.error("Proxy Error:", error);
        return NextResponse.json({ message: error.message }, { status: 500 });
    }
}
