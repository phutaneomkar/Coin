
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load directly from the .env file in the current directory (frontend)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials in .env file');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000000'; // Or fetch from the script args if dynamic

async function debugHoldings() {
    console.log('--- Debugging Holdings ---');
    console.log(`User ID: ${DEFAULT_USER_ID}`);

    // Fetch all holdings
    const { data: holdings, error } = await supabase
        .from('holdings')
        .select('*')
        .eq('user_id', DEFAULT_USER_ID);

    if (error) {
        console.error('Error fetching holdings:', error);
        return;
    }

    console.log(`Found ${holdings.length} holding records.`);

    // Check for duplicates
    const map = new Map();
    const duplicates: any[] = [];

    holdings.forEach(h => {
        const key = h.coin_id.toLowerCase().trim();
        if (map.has(key)) {
            duplicates.push({ original: map.get(key), duplicate: h });
        } else {
            map.set(key, h);
        }
        console.log(`[${h.coin_id}] Qty: ${h.quantity}, Avg: ${h.average_buy_price} (ID: ${h.id})`);
    });

    if (duplicates.length > 0) {
        console.log('\n!!! DUPLICATES DETECTED !!!');
        duplicates.forEach(d => {
            console.log(`Duplicate found for ${d.original.coin_id}: IDs ${d.original.id} and ${d.duplicate.id}`);
        });
    } else {
        console.log('\nNo duplicates found.');
    }

    // Check orders
    console.log('\n--- Pending Orders ---');
    const { data: orders } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', DEFAULT_USER_ID)
        .eq('order_status', 'pending');

    if (orders) {
        orders.forEach(o => {
            console.log(`[${o.order_type.toUpperCase()}] ${o.coin_symbol} (${o.coin_id}) Qty: ${o.quantity}`);
        });
    }
}

debugHoldings();
