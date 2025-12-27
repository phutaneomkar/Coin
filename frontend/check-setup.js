const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

async function checkSetup() {
    console.log("--- Diagnostic Check ---");

    // 1. Check Env Vars
    const hasUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
    const hasKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

    console.log(`NEXT_PUBLIC_SUPABASE_URL found: ${hasUrl}`);
    console.log(`SUPABASE_SERVICE_ROLE_KEY found: ${hasKey}`);

    if (!hasUrl || !hasKey) {
        console.error("❌ Missing Environment Variables!");
        return;
    }

    // 2. Check Default Profile
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const userId = '00000000-0000-0000-0000-000000000000';

    const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

    if (error) {
        console.log(`❌ Default Profile Check Failed: ${error.message}`);
        console.log("Attempting to create default profile...");

        const { error: insertError } = await supabase
            .from('profiles')
            .insert({
                id: userId,
                email: 'guest@automation.com',
                balance_inr: 100000.00,
                full_name: 'Automation Guest'
            });

        if (insertError) {
            console.error(`❌ Failed to create guest profile: ${insertError.message}`);
        } else {
            console.log("✅ Created Guest Profile successfully! Restart automation to test.");
        }

    } else {
        console.log(`✅ Default Profile found: ${profile.full_name}, Balance: ${profile.balance_inr}`);
    }
}

checkSetup();
