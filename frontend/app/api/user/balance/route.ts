import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { DEFAULT_USER_ID } from '@/lib/auth-utils';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        let userId = user?.id;

        if (!userId) {
            const hasAccess = request.cookies.has('app_access');
            if (hasAccess) {
                userId = DEFAULT_USER_ID;
            } else {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
        }

        const { data: profile, error } = await supabase
            .from('profiles')
            .select('balance_inr')
            .eq('id', userId)
            .single();

        if (error) {
            console.error('Balance Fetch Error:', error);
            return NextResponse.json({ error: 'Failed to fetch balance' }, { status: 500 });
        }

        return NextResponse.json({ balance: profile?.balance_inr ?? 0 });
    } catch (error: any) {
        console.error('API Error:', error);
        return NextResponse.json({ message: error.message }, { status: 500 });
    }
}
