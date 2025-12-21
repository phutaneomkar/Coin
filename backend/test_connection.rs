use std::env;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Load .env file
    dotenvy::dotenv().ok();

    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set in .env file");
    let database_url_fallback = env::var("DATABASE_URL_FALLBACK")
        .ok()
        .map(|raw| raw.trim().trim_matches('"').trim_matches('\'').to_string())
        .filter(|s| !s.is_empty());

    println!("🔍 Testing database connection...");
    println!(
        "Connection string (password hidden):\n  {}",
        redact_database_url(&database_url)
    );

    println!("\n📡 Attempting to connect...");

    match sqlx::PgPool::connect(&database_url).await {
        Ok(_) => {
            println!("✅ SUCCESS! Database connection established!");
            println!("   Your backend should work now. Try running: cargo run");
            Ok(())
        }
        Err(e) => {
            if let Some(fallback_url) = database_url_fallback.as_deref() {
                println!(
                    "\n⚠️ Primary failed, trying fallback:\n  {}",
                    redact_database_url(fallback_url)
                );

                if sqlx::PgPool::connect(fallback_url).await.is_ok() {
                    println!("✅ SUCCESS! Database connection established (fallback)!");
                    println!("   Your backend should work now. Try running: cargo run");
                    return Ok(());
                }
            }

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
            } else if e.to_string().contains("password") || e.to_string().contains("authentication")
            {
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

fn redact_database_url(database_url: &str) -> String {
    match url::Url::parse(database_url) {
        Ok(mut parsed) => {
            let _ = parsed.set_password(Some("********"));
            parsed.to_string()
        }
        Err(_) => "<invalid DATABASE_URL>".to_string(),
    }
}
