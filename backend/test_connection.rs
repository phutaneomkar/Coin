use std::env;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Load .env file
    dotenv::dotenv().ok();
    
    let database_url = env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set in .env file");
    
    println!("🔍 Testing database connection...");
    println!("Connection string (password hidden):");
    if let Some(at_pos) = database_url.find('@') {
        if let Some(colon_pos) = database_url[..at_pos].rfind(':') {
            let mut display_url = database_url.clone();
            let password_start = colon_pos + 1;
            let password_end = at_pos;
            let password_len = password_end - password_start;
            display_url.replace_range(password_start..password_end, &"*".repeat(password_len));
            println!("  {}", display_url);
        }
    } else {
        println!("  {}", database_url);
    }
    
    println!("\n📡 Attempting to connect...");
    
    match sqlx::PgPool::connect(&database_url).await {
        Ok(_) => {
            println!("✅ SUCCESS! Database connection established!");
            println!("   Your backend should work now. Try running: cargo run");
            Ok(())
        }
        Err(e) => {
            println!("❌ Connection failed!");
            println!("\nError details:");
            println!("  {}", e);
            
            // Provide helpful suggestions
            if e.to_string().contains("No such host") {
                println!("\n💡 Suggestions:");
                println!("  1. Verify your Supabase project is ACTIVE (not paused)");
                println!("  2. Check the hostname in your connection string");
                println!("  3. Verify the connection string in Supabase Dashboard:");
                println!("     Settings → Database → Connection string → URI");
                println!("  4. Try restarting your computer (DNS cache issue)");
            } else if e.to_string().contains("password") || e.to_string().contains("authentication") {
                println!("\n💡 Suggestions:");
                println!("  1. Verify your database password is correct");
                println!("  2. If password contains special characters, URL-encode them:");
                println!("     @ → %40, # → %23, % → %25");
            } else if e.to_string().contains("timeout") {
                println!("\n💡 Suggestions:");
                println!("  1. Check your internet connection");
                println!("  2. Verify firewall isn't blocking port 5432");
            }
            
            Err(format!("Connection error: {}", e).into())
        }
    }
}

