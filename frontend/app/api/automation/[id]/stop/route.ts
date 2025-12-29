import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        let userId = user?.id;

        if (!userId) {
            const hasAccess = request.cookies.has('app_access');
            if (hasAccess) {
                userId = '00000000-0000-0000-0000-000000000000';
            } else {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
        }

        // Smart URL resolution: In development, prefer NEXT_PUBLIC_API_URL if BACKEND_URL has wrong port
        const isDevelopment = process.env.NODE_ENV === 'development';
        let baseUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:3001';
        
        // In development, if BACKEND_URL points to wrong port (3002), prefer NEXT_PUBLIC_API_URL
        if (isDevelopment && process.env.BACKEND_URL) {
            const backendUrl = process.env.BACKEND_URL;
            const hasWrongPort = backendUrl.includes(':3002') || backendUrl.includes('localhost:3002');
            if (hasWrongPort && process.env.NEXT_PUBLIC_API_URL) {
                baseUrl = process.env.NEXT_PUBLIC_API_URL;
            }
        }
        const res = await fetch(`${baseUrl}/api/automation/${id}/stop`, {
            method: "POST",
        });

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
