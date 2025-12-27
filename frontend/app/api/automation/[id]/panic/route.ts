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

        // Auth check (allow fallback)
        if (!user && !request.cookies.has('app_access')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const res = await fetch(`http://127.0.0.1:3001/api/automation/${id}/panic`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
        });

        const data = await res.json();
        return NextResponse.json(data, { status: res.status });

    } catch (error: any) {
        console.error("Proxy Panic Error:", error);
        return NextResponse.json({ message: error.message }, { status: 500 });
    }
}
