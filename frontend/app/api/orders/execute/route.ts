import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { executeOrder } from '../../../../lib/services/orders';

export async function POST(request: NextRequest) {
  try {
    const { orderId, executionPrice } = await request.json();

    if (!orderId || !executionPrice) {
      return NextResponse.json({ error: 'Missing orderId or executionPrice' }, { status: 400 });
    }

    console.log(`🚀 Executing matched order ${orderId} at price ${executionPrice}`);

    // Use Admin Client as this request comes from the System (Rust Backend)
    const supabase = createAdminClient();

    // 1. Fetch Order
    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (error || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // 2. Check if already completed?
    // Wait, Rust updates it to 'completed' BEFORE calling this?
    // If so, we can't check order_status === 'completed' to prevent double execution.
    // Instead we check `transactions` table.

    // Check if transaction already exists for this order
    const { data: txn } = await supabase
      .from('transactions')
      .select('id')
      .eq('order_id', orderId)
      .maybeSingle();

    if (txn) {
      console.log(`⚠️ Order ${orderId} already has a transaction. Skipping execution.`);
      return NextResponse.json({ message: 'Already executed' });
    }

    // 3. Execute (Deduct Balance / Add Holdings)
    await executeOrder(supabase, order.user_id, order, executionPrice);

    return NextResponse.json({ success: true, message: 'Order executed successfully' });

  } catch (error) {
    console.error('Error executing order:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
