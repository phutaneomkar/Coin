use sqlx::PgPool;
use std::env;
use uuid::Uuid;
use rust_decimal::Decimal;
use chrono::{DateTime, Utc};

#[derive(Debug, sqlx::FromRow)]
struct Strategy {
    id: Uuid,
    user_id: Uuid,
    amount: Decimal,
    profit_percentage: Decimal,
    status: String,
    current_coin_id: Option<String>,
    current_order_id: Option<Uuid>,
    entry_price: Option<Decimal>,
}

#[derive(Debug, sqlx::FromRow)]
struct Order {
    id: Uuid,
    coin_symbol: String,
    order_type: String,
    order_status: String,
    price_per_unit: Option<Decimal>,
    quantity: Decimal,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPool::connect(&database_url).await?;

    println!("🔍 --- DIAGNOSTIC REPORT ---");

    // 1. Check Strategies
    let strategies = sqlx::query_as::<_, Strategy>("SELECT * FROM strategies WHERE status = 'running'")
        .fetch_all(&pool)
        .await?;

    println!("📊 Running Strategies: {}", strategies.len());

    for s in strategies {
        println!("\nStrategy ID: {}", s.id);
        println!("  Coin: {:?}", s.current_coin_id);
        println!("  Order ID: {:?}", s.current_order_id);
        println!("  Entry Price: {:?}", s.entry_price);

        if let Some(oid) = s.current_order_id {
            // Check mapped order
            let order = sqlx::query_as::<_, Order>("SELECT id, coin_symbol, order_type, order_status, price_per_unit, quantity FROM orders WHERE id = $1")
                .bind(oid)
                .fetch_optional(&pool)
                .await?;

            if let Some(o) = order {
                println!("  -> LINKED ORDER: {} {} @ {:?} - Status: [{}]", o.order_type.to_uppercase(), o.coin_symbol, o.price_per_unit, o.order_status);
            } else {
                println!("  -> LINKED ORDER NOT FOUND! (Critical state error?)");
            }
        }
    }

    println!("\n🔍 --- END REPORT ---");
    Ok(())
}
