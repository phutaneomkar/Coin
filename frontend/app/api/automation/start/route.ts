import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        let userId = user?.id;

        // Fallback for custom auth: check cookie and use default ID
        if (!userId) {
            const hasAccess = request.cookies.has('app_access');
            if (hasAccess) {
                // Use known default ID for custom auth flow
                userId = '00000000-0000-0000-0000-000000000000';
                console.log("DEBUG Proxy Start: Using fallback DEFAULT_USER_ID due to app_access cookie");
            } else {
                console.log("DEBUG Proxy Start: Unauthorized - No User and no app_access cookie", authError);
                return NextResponse.json({ error: 'Unauthorized', details: authError }, { status: 401 });
            }
        }

        const payload = await request.json();

        // Force user_id to be the authenticated/fallback user
        const backendPayload = {
            ...payload,
            user_id: userId
        };

        const res = await fetch("http://127.0.0.1:3001/api/automation/start", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(backendPayload),
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
