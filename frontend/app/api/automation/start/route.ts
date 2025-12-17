import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { priceLimit, percentage, orderCount, durationHours, durationMinutes } = body;

        // Validate inputs
        if (!priceLimit || !percentage || !orderCount) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const amount = parseFloat(priceLimit);
        const profitPercentage = parseFloat(percentage);
        const totalIterations = parseInt(orderCount);
        const duration = (parseInt(durationHours || '0') * 60) + parseInt(durationMinutes || '0');

        if (amount <= 0 || profitPercentage <= 0 || totalIterations <= 0 || duration <= 0) {
            return NextResponse.json({ error: 'Invalid input values' }, { status: 400 });
        }

        // Insert Strategy
        const { data, error } = await supabase
            .from('strategies')
            .insert({
                user_id: user.id,
                amount,
                profit_percentage: profitPercentage,
                total_iterations: totalIterations,
                duration_minutes: duration,
                status: 'running',
                iterations_completed: 0
            })
            .select()
            .single();

        if (error) {
            console.error('Error creating strategy:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, strategy: data });
    } catch (error) {
        console.error('Error starting automation:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
