import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '../../../../lib/supabase/server';

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { orderId } = await request.json();

        if (!orderId) {
            return NextResponse.json({ error: 'Order ID is required' }, { status: 400 });
        }

        // specific check: Verify order exists, belongs to user, and is pending
        const { data: order, error: fetchError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .eq('user_id', user.id)
            .single();

        if (fetchError || !order) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

        if (order.order_status !== 'pending') {
            return NextResponse.json({
                error: `Cannot cancel order in '${order.order_status}' status. Only pending orders can be cancelled.`
            }, { status: 400 });
        }

        // Update order status to cancelled
        const { error: updateError } = await supabase
            .from('orders')
            .update({
                order_status: 'cancelled',
                // Optional: track cancelled_at if you have a column for it, otherwise just updating status is enough
            })
            .eq('id', orderId);

        if (updateError) {
            console.error('Error cancelling order:', updateError);
            return NextResponse.json({ error: 'Failed to cancel order' }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            message: 'Order cancelled successfully',
            orderId
        });

    } catch (error) {
        console.error('Error in cancel order API:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
