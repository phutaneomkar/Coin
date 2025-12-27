
import { NextResponse } from 'next/server';
import { createClient } from '../../../../lib/supabase/server';
import { DEFAULT_USER_ID } from '../../../../lib/auth-utils';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const userId = DEFAULT_USER_ID;

  const { data: holdings, error } = await supabase
    .from('holdings')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Analyze duplicates
  const map = new Map();
  const duplicates: any[] = [];
  const report: any[] = [];

  holdings.forEach(h => {
    const key = (h.coin_id || '').toLowerCase().trim();
    if (map.has(key)) {
      duplicates.push({
        coin: key,
        ids: [map.get(key).id, h.id],
        quantities: [map.get(key).quantity, h.quantity]
      });
    } else {
      map.set(key, h);
    }
    report.push({
      id: h.id,
      coin_id: h.coin_id,
      key: key,
      quantity: h.quantity,
      avg_price: h.average_buy_price
    });
  });

  return NextResponse.json({
    count: holdings.length,
    duplicates,
    holdings: report
  });
}
