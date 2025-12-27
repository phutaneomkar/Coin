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

        const res = await fetch(`http://127.0.0.1:3001/api/automation/${id}/stop`, {
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
