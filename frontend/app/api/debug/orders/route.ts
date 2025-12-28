import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '../../../../lib/supabase/server';

export async function GET(request: NextRequest) {
    try {
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001';
        const res = await fetch(`${baseUrl}/api/orders/recent`, { cache: 'no-store' });
        const data = await res.json();
        return NextResponse.json(data);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
