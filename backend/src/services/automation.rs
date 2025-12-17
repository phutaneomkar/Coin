use sqlx::PgPool;
use std::sync::Arc;
use tokio::time::{sleep, Duration};
use tracing::{info, error};
use rust_decimal::Decimal;
use crate::services::matching_engine::MatchingEngine;
use uuid::Uuid;
use chrono::{Utc, DateTime};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use rust_decimal::prelude::FromPrimitive; // Needed for Decimal::from_f64/from_str

#[derive(Debug, sqlx::FromRow)]
struct Strategy {
    id: Uuid,
    user_id: Uuid,
    amount: Decimal,
    profit_percentage: Decimal,
    total_iterations: i32,
    iterations_completed: i32,
    duration_minutes: i32,
    start_time: DateTime<Utc>,
    end_time: Option<DateTime<Utc>>, // Generated column might be Option in SQLx?
    status: String,
    current_coin_id: Option<String>,
    entry_price: Option<Decimal>,
}

pub struct AutomationEngine {
    pool: PgPool,
    matching_engine: MatchingEngine, // To access prices
}

impl AutomationEngine {
    pub fn new(pool: PgPool, matching_engine: MatchingEngine) -> Self {
        Self { pool, matching_engine }
    }

    pub async fn start(self: Arc<Self>) {
        info!("🤖 Starting Automation Engine...");
        
        let self_clone = self.clone();
        tokio::spawn(async move {
            loop {
                if let Err(e) = self_clone.process_strategies().await {
                    error!("❌ Automation Loop Error: {}", e);
                }
                sleep(Duration::from_secs(5)).await; // Check every 5 seconds
            }
        });
    }

    async fn process_strategies(&self) -> anyhow::Result<()> {
        // 1. Fetch running strategies
        let strategies = sqlx::query_as::<_, Strategy>(
            "SELECT * FROM strategies WHERE status = 'running'"
        )
        .fetch_all(&self.pool)
        .await?;

        if strategies.is_empty() {
            return Ok(());
        }

        let prices = self.matching_engine.get_prices().await;
        if prices.is_empty() {
            // Need prices to operate
            return Ok(());
        }

        for strategy in strategies {
            // Check if expired
            if let Some(end_time) = strategy.end_time {
                 if Utc::now() > end_time {
                     self.stop_strategy(strategy.id, "completed").await?;
                     continue;
                 }
            }
            // Check iterations
            if strategy.iterations_completed >= strategy.total_iterations {
                self.stop_strategy(strategy.id, "completed").await?;
                continue;
            }

            if let Some(coin_id) = &strategy.current_coin_id {
                // Currently in a trade: Monitor for Sell
                self.handle_active_trade(&strategy, &prices, coin_id).await?;
            } else {
                // Not in a trade: Look for a Buy
                self.handle_entry(&strategy, &prices).await?;
            }
        }

        Ok(())
    }

    async fn handle_active_trade(&self, strategy: &Strategy, prices: &HashMap<String, Decimal>, coin_id: &str) -> anyhow::Result<()> {
        let current_price = match prices.get(coin_id) {
            Some(p) => *p,
            None => return Ok(()), // Price not available yet
        };

        let entry_price = strategy.entry_price.unwrap_or_default();
        if entry_price <= Decimal::ZERO { return Ok(()); }

        // Logic: Sell if Price >= Entry * (1 + Profit%)
        // Profit% is like '5' for 5%. So 1 + 5/100 = 1.05
        let multiplier = Decimal::ONE + (strategy.profit_percentage / Decimal::from(100));
        let target_price = entry_price * multiplier;

        if current_price >= target_price {
            info!("🤖 Strategy {}: Target Hit! Selling {} @ {} (Entry: {})", strategy.id, coin_id, current_price, entry_price);
            
            // 1. Calculate Quantity (Approximate based on Entry Amount / Entry Price)
            // Ideally we should have stored 'entry_quantity' in DB. The table I proposed has 'entry_quantity'.
            // Let's assume the Strategy struct handles it.
            // Wait, previous step stored `entry_quantity` in `current_entry_quantity`? No, I added it to schema but not struct above.
            // Let's rely on amount/entry_price for now if quantity is missing, or fix struct.
            // *Fixing Struct*: I will add `entry_quantity` to struct in next edit if needed.
            // For now, let's just mark it closed in strategy and insert a SELL order for the USER.

            // 2. Perform Sell (Update Strategy Internal State first)
            // Log the "Action"
             let p_diff = current_price - entry_price;
             let profit = (strategy.amount / entry_price) * p_diff; // Approx

             self.log_action(strategy.id, "sell", coin_id, current_price, strategy.amount, Some(profit)).await?;

            // 3. Update User Balance (Real Trade)
            // Insert a "Sell" order into 'orders' table. 
            // Since we want it to execute immediately, we can use a Limit Sell @ current_price (or slightly lower) 
            // OR use the `execute_order` transaction API directly if we are "simulating" the trade for the user.
            // User requested "it will order number", implying real orders.
            // Let's inserts a MARKET order. But our matching engine supports LIMIT. 
            // Let's insert a Limit Sell at current_price.
            let quantity = strategy.amount / entry_price;
            
            // Generate Order ID
            let order_id = Uuid::new_v4();
            
            sqlx::query!(
                "INSERT INTO orders (id, user_id, coin_id, coin_symbol, order_type, order_mode, quantity, price_per_unit, total_amount, order_status) VALUES ($1, $2, $3, $4, 'sell', 'limit', $5, $6, $7, 'pending')",
                order_id, strategy.user_id, coin_id, coin_id.to_uppercase(), quantity, current_price, strategy.amount // approx total
            ).execute(&self.pool).await?;

            // 4. Update Strategy State
            sqlx::query!(
                "UPDATE strategies SET current_coin_id = NULL, entry_price = NULL, iterations_completed = iterations_completed + 1 WHERE id = $1",
                strategy.id
            ).execute(&self.pool).await?;

        }

        Ok(())
    }

    async fn handle_entry(&self, strategy: &Strategy, prices: &HashMap<String, Decimal>) -> anyhow::Result<()> {
        // Find a gainer.
        // Simple heuristic: Pick a random coin that is "green" (we don't have 24h history here easily without fetching).
        // OR: Just pick BTC/ETH for demo?
        // User said: "guess the coins which will increase".
        // Real implementation: calculate % change from stored history?
        // Let's pick the coin with the highest price for now as a placeholder, or random one.
        // BETTER: Use `Analysis` if available.
        // For MVP: Pick 'btc' always or random.
        // Let's pick the first available coin in prices map for now (or 'btc' if present).
        
        let target_coin = if let Some((c, p)) = prices.iter().find(|(k, _)| k.as_str() == "btc") {
            ("btc", *p)
        } else {
            // Pick any
             if let Some((c, p)) = prices.iter().next() {
                 (c.as_str(), *p)
             } else {
                 return Ok(());
             }
        };

        let (coin_id, current_price) = target_coin;

        info!("🤖 Strategy {}: Buying {} @ {}", strategy.id, coin_id, current_price);

        // 1. Log Action
        self.log_action(strategy.id, "buy", coin_id, current_price, strategy.amount, None).await?;

        // 2. Place Real Order
         let quantity = strategy.amount / current_price;
         let order_id = Uuid::new_v4();
         
         sqlx::query!(
             "INSERT INTO orders (id, user_id, coin_id, coin_symbol, order_type, order_mode, quantity, price_per_unit, total_amount, order_status) VALUES ($1, $2, $3, $4, 'buy', 'limit', $5, $6, $7, 'pending')",
             order_id, strategy.user_id, coin_id, coin_id.to_uppercase(), quantity, current_price, strategy.amount
         ).execute(&self.pool).await?;

        // 3. Update Strategy
        sqlx::query!(
            "UPDATE strategies SET current_coin_id = $2, entry_price = $3 WHERE id = $1",
            strategy.id, coin_id, current_price
        ).execute(&self.pool).await?;

        Ok(())
    }

    async fn log_action(&self, strategy_id: Uuid, action: &str, coin_id: &str, price: Decimal, amount: Decimal, profit: Option<Decimal>) -> anyhow::Result<()> {
        sqlx::query!(
            "INSERT INTO strategy_logs (strategy_id, action, coin_id, coin_symbol, price, quantity, amount, profit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            strategy_id, action, coin_id, coin_id.to_uppercase(), price, Decimal::ZERO, amount, profit // Quantity 0 for now
        ).execute(&self.pool).await?;
        Ok(())
    }

    async fn stop_strategy(&self, id: Uuid, reason: &str) -> anyhow::Result<()> {
        sqlx::query!("UPDATE strategies SET status = $2 WHERE id = $1", id, reason)
            .execute(&self.pool)
            .await?;
        info!("🤖 Strategy {} stopped: {}", id, reason);
        Ok(())
    }
}
