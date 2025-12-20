use sqlx::PgPool;
use std::sync::Arc;
use tokio::time::{sleep, Duration};
use tracing::{info, error, warn};
use rust_decimal::Decimal;
use crate::services::matching_engine::MatchingEngine;
use uuid::Uuid;
use chrono::{Utc, DateTime};
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use reqwest::Client;
use futures::stream::{self, StreamExt};

#[derive(Debug, sqlx::FromRow)]
#[allow(dead_code)]
struct Strategy {
    id: Uuid,
    user_id: Uuid,
    amount: Decimal,
    profit_percentage: Decimal,
    total_iterations: i32,
    iterations_completed: i32,
    duration_minutes: i32,
    start_time: DateTime<Utc>,
    end_time: Option<DateTime<Utc>>,
    status: String,
    current_coin_id: Option<String>,
    current_order_id: Option<Uuid>,
    entry_price: Option<Decimal>,
}

#[derive(Debug, Deserialize)]
struct BinanceOrderBookResponse {
    bids: Vec<[String; 2]>, // [price, quantity]
    asks: Vec<[String; 2]>, // [price, quantity]
}

#[derive(Debug, Clone)]
struct CoinAnalysis {
    coin_id: String,
    current_price: Decimal,
    predicted_price_10s: Decimal,
    price_change_percent: Decimal,
    buy_pressure: Decimal, // Total buy quantity * price
    sell_pressure: Decimal, // Total sell quantity * price
}

pub struct AutomationEngine {
    pool: PgPool,
    matching_engine: MatchingEngine,
    http_client: Client,
}

impl AutomationEngine {
    pub fn new(pool: PgPool, matching_engine: MatchingEngine) -> Self {
        Self {
            pool,
            matching_engine,
            http_client: Client::new(),
        }
    }

    pub async fn start(self: Arc<Self>) {
        info!("🤖 Starting Advanced Automation Engine...");

        // Ensure Schema Migration
        if let Err(e) = sqlx::query("ALTER TABLE strategies ADD COLUMN IF NOT EXISTS current_order_id uuid").execute(&self.pool).await {
             error!("⚠️ Failed to run runtime migration for strategies: {}", e);
        }
        
        let self_clone = self.clone();
        tokio::spawn(async move {
            loop {
                if let Err(e) = self_clone.process_strategies().await {
                    error!("❌ Automation Loop Error: {}", e);
                }
                sleep(Duration::from_secs(2)).await; // Check every 2 seconds for faster response
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

        // 2. Check limits FIRST before processing
        for strategy in &strategies {
            // Check time limit
            if let Some(end_time) = strategy.end_time {
                if Utc::now() >= end_time {
                    info!("⏰ Strategy {} reached time limit. Stopping immediately.", strategy.id);
                    self.stop_strategy(strategy.id, "completed").await?;
                    continue;
                }
            } else {
                // Calculate end_time if not set
                let end_time = strategy.start_time + chrono::Duration::minutes(strategy.duration_minutes as i64);
                if Utc::now() >= end_time {
                    info!("⏰ Strategy {} reached time limit. Stopping immediately.", strategy.id);
                    self.stop_strategy(strategy.id, "completed").await?;
                    continue;
                }
            }

            // Check order count limit
            if strategy.iterations_completed >= strategy.total_iterations {
                info!("📊 Strategy {} reached order limit ({} orders). Stopping immediately.", strategy.id, strategy.total_iterations);
                self.stop_strategy(strategy.id, "completed").await?;
                continue;
            }
        }

        // 3. Get current prices
        let prices = self.matching_engine.get_prices().await;
        if prices.is_empty() {
            return Ok(());
        }

        // 4. Process each strategy
        for strategy in strategies {
            // Double-check status (might have been stopped above)
            let current_strategy = sqlx::query_as::<_, Strategy>(
                "SELECT * FROM strategies WHERE id = $1 AND status = 'running'"
            )
            .bind(strategy.id)
            .fetch_optional(&self.pool)
            .await?;

            let strategy = match current_strategy {
                Some(s) => s,
                None => continue, // Strategy was stopped
            };

            if let Some(order_id) = strategy.current_order_id {
                // Monitor Active Order (Buy or Sell)
                self.check_order_status(&strategy, order_id).await?;
            } else if let Some(coin_id) = &strategy.current_coin_id {
                // Currently holding a coin, waiting for sell order
                self.handle_active_trade(&strategy, &prices, coin_id).await?;
            } else {
                // Not in a trade: Analyze ALL coins and find best opportunity
                self.handle_entry(&strategy, &prices).await?;
            }
        }

        Ok(())
    }

    async fn check_order_status(&self, strategy: &Strategy, order_id: Uuid) -> anyhow::Result<()> {
        let order = sqlx::query!(
            "SELECT order_status, order_type, price_per_unit, quantity FROM orders WHERE id = $1",
            order_id
        )
        .fetch_optional(&self.pool)
        .await?;

        if let Some(order) = order {
            if order.order_status == "completed" {
                if order.order_type == "buy" {
                    // BUY COMPLETED -> PLACE SELL IMMEDIATELY
                    let buy_price = order.price_per_unit.unwrap_or(Decimal::ZERO);
                    if buy_price <= Decimal::ZERO { return Ok(()); }
                    
                    let coin_id = strategy.current_coin_id.as_deref().unwrap_or("unknown");

                    info!("✅ Strategy {} Buy Complete @ {}. Placing Limit Sell immediately...", strategy.id, buy_price);

                    // Calculate Sell Target Price (buy_price * (1 + profit_percentage/100))
                    let multiplier = Decimal::ONE + (strategy.profit_percentage / Decimal::from(100));
                    let target_price = buy_price * multiplier;

                    // Place Limit Sell Order IMMEDIATELY
                    let quantity = order.quantity;
                    let sell_order_id = Uuid::new_v4();

                    sqlx::query!(
                        "INSERT INTO orders (id, user_id, coin_id, coin_symbol, order_type, order_mode, quantity, price_per_unit, total_amount, order_status) VALUES ($1, $2, $3, $4, 'sell', 'limit', $5, $6, $7, 'pending')",
                        sell_order_id, strategy.user_id, coin_id, coin_id.to_uppercase(), quantity, target_price, target_price * quantity
                    ).execute(&self.pool).await?;

                    // Add to matching engine for immediate matching
                    self.matching_engine.add_order(
                        sell_order_id.to_string(),
                        coin_id.to_string(),
                        "sell".to_string(),
                        target_price,
                        quantity,
                    ).await;

                    // Update Strategy to track SELL order
                    sqlx::query!(
                        "UPDATE strategies SET current_order_id = $2, entry_price = $3 WHERE id = $1",
                        strategy.id, sell_order_id, buy_price
                    ).execute(&self.pool).await?;

                    info!("🚀 Strategy {} Limit Sell Order Placed @ {} ({}% profit target)", strategy.id, target_price, strategy.profit_percentage);

                } else if order.order_type == "sell" {
                    // SELL COMPLETED -> FINISH ITERATION
                    info!("💰 Strategy {} Sell Complete. Profit Secured. Iteration {}/{}", 
                        strategy.id, strategy.iterations_completed + 1, strategy.total_iterations);
                    
                    let sell_price = order.price_per_unit.unwrap_or_default();
                    let entry_price = strategy.entry_price.unwrap_or(sell_price);
                    
                    // Log Profit
                    let quantity = order.quantity;
                    let profit = (sell_price - entry_price) * quantity;
                    let coin_id = strategy.current_coin_id.as_deref().unwrap_or("unknown");

                    self.log_action(strategy.id, "sell", coin_id, sell_price, sell_price * quantity, Some(profit)).await?;

                    // Reset Strategy for next iteration
                    sqlx::query!(
                        "UPDATE strategies SET current_coin_id = NULL, current_order_id = NULL, entry_price = NULL, iterations_completed = iterations_completed + 1 WHERE id = $1",
                        strategy.id
                    ).execute(&self.pool).await?;
                }
            } else if order.order_status == "cancelled" || order.order_status == "failed" {
                // Handle Cancelled/Failed Orders
                if order.order_type == "buy" {
                    info!("⚠️ Strategy {} Buy Order {} Cancelled/Failed. Resetting entry search.", strategy.id, order_id);
                    sqlx::query!(
                        "UPDATE strategies SET current_coin_id = NULL, current_order_id = NULL, entry_price = NULL WHERE id = $1",
                        strategy.id
                    ).execute(&self.pool).await?;
                } else if order.order_type == "sell" {
                    info!("⚠️ Strategy {} Sell Order {} Cancelled/Failed. Resuming price monitoring.", strategy.id, order_id);
                    sqlx::query!(
                        "UPDATE strategies SET current_order_id = NULL WHERE id = $1",
                        strategy.id
                    ).execute(&self.pool).await?;
                }
            }
        } else {
            info!("⚠️ Strategy {} tracked order {} not found. Clearing track.", strategy.id, order_id);
            sqlx::query!(
                "UPDATE strategies SET current_order_id = NULL WHERE id = $1",
                strategy.id
            ).execute(&self.pool).await?;
        }
        Ok(())
    }

    async fn handle_active_trade(&self, strategy: &Strategy, prices: &HashMap<String, Decimal>, coin_id: &str) -> anyhow::Result<()> {
        // This should rarely happen now since we place sell order immediately after buy
        // But keep as fallback
        let current_price = match prices.get(coin_id) {
            Some(p) => *p,
            None => return Ok(()),
        };

        let entry_price = strategy.entry_price.unwrap_or_default();
        if entry_price <= Decimal::ZERO { return Ok(()); }

        let multiplier = Decimal::ONE + (strategy.profit_percentage / Decimal::from(100));
        let target_price = entry_price * multiplier;

        if current_price >= target_price {
            info!("🤖 Strategy {}: Target Hit! Selling {} @ {} (Entry: {})", strategy.id, coin_id, current_price, entry_price);
            
            let quantity = strategy.amount / entry_price;
            let order_id = Uuid::new_v4();
            
            sqlx::query!(
                "INSERT INTO orders (id, user_id, coin_id, coin_symbol, order_type, order_mode, quantity, price_per_unit, total_amount, order_status) VALUES ($1, $2, $3, $4, 'sell', 'limit', $5, $6, $7, 'pending')",
                order_id, strategy.user_id, coin_id, coin_id.to_uppercase(), quantity, current_price, current_price * quantity
            ).execute(&self.pool).await?;

            self.matching_engine.add_order(
                order_id.to_string(),
                coin_id.to_string(),
                "sell".to_string(),
                current_price,
                quantity,
            ).await;

            sqlx::query!(
                "UPDATE strategies SET current_order_id = $2 WHERE id = $1",
                strategy.id, order_id
            ).execute(&self.pool).await?;
        }

        Ok(())
    }

    async fn handle_entry(&self, strategy: &Strategy, _prices: &HashMap<String, Decimal>) -> anyhow::Result<()> {
        // ANALYZE TOP LIQUID COINS (Top 50 by Volume)
        // This avoids API Rate Limits and ensures we trade real assets.
        info!("🔍 Strategy {}: Fetching Top 50 High-Volume Coins...", strategy.id);

        let top_coins = self.matching_engine.get_top_volume_coins(50).await;
        
        if top_coins.is_empty() {
             warn!("⚠️ Strategy {}: No liquid coins found yet. Waiting for market data...", strategy.id);
             return Ok(());
        }

        // Parallel Analysis with Concurrency Limit (10 concurrent requests)
        let mut analyses = stream::iter(top_coins)
            .map(|(coin_id, ticker_data)| {
                let self_ref = &self;
                async move {
                    self_ref.analyze_coin(&coin_id, ticker_data.price).await
                }
            })
            .buffer_unordered(10) // Limit concurrency to avoid IP bans
            .filter_map(|res| async {
                match res {
                    Ok(analysis) => Some(analysis),
                    Err(_) => None, // Skip failed fetches
                }
            })
            .collect::<Vec<_>>()
            .await;

        if analyses.is_empty() {
            warn!("⚠️ Strategy {}: Analysis failed for all candidates. Skipping cycle.", strategy.id);
            return Ok(());
        }

        // Find coin with highest predicted price increase that meets threshold
        let threshold_percent = strategy.profit_percentage;
        let best_coin = analyses
            .iter()
            .filter(|a| a.price_change_percent >= threshold_percent)
            .max_by(|a, b| a.price_change_percent.cmp(&b.price_change_percent));

        if let Some(best) = best_coin {
            info!("🎯 Strategy {}: Best opportunity found! {} predicted to increase {}% (Current: {}, Predicted: {})", 
                strategy.id, best.coin_id, best.price_change_percent, best.current_price, best.predicted_price_10s);

            // Place MARKET BUY order immediately
            let quantity = strategy.amount / best.current_price;
            let buy_order_id = Uuid::new_v4();

            info!("💸 Strategy {}: Placing MARKET BUY for {} @ {} (Quantity: {})", 
                strategy.id, best.coin_id, best.current_price, quantity);

            // Place market order (will execute immediately)
            sqlx::query!(
                "INSERT INTO orders (id, user_id, coin_id, coin_symbol, order_type, order_mode, quantity, price_per_unit, total_amount, order_status) VALUES ($1, $2, $3, $4, 'buy', 'market', $5, $6, $7, 'completed')",
                buy_order_id, strategy.user_id, best.coin_id, best.coin_id.to_uppercase(), quantity, best.current_price, strategy.amount
            ).execute(&self.pool).await?;

            // Log the buy action
            self.log_action(strategy.id, "buy", &best.coin_id, best.current_price, strategy.amount, None).await?;

            // Update user balance and holdings (simulate immediate execution)
            // This should be handled by the order execution API, but we'll trigger it
            let client = reqwest::Client::new();
            let _ = client.post("http://127.0.0.1:3000/api/orders/execute")
                .json(&serde_json::json!({
                    "orderId": buy_order_id.to_string(),
                    "executionPrice": best.current_price.to_string()
                }))
                .send()
                .await;

            // Immediately place limit sell order
            let multiplier = Decimal::ONE + (strategy.profit_percentage / Decimal::from(100));
            let target_price = best.current_price * multiplier;
            let sell_order_id = Uuid::new_v4();

            sqlx::query!(
                "INSERT INTO orders (id, user_id, coin_id, coin_symbol, order_type, order_mode, quantity, price_per_unit, total_amount, order_status) VALUES ($1, $2, $3, $4, 'sell', 'limit', $5, $6, $7, 'pending')",
                sell_order_id, strategy.user_id, best.coin_id, best.coin_id.to_uppercase(), quantity, target_price, target_price * quantity
            ).execute(&self.pool).await?;

            // Add to matching engine
            self.matching_engine.add_order(
                sell_order_id.to_string(),
                best.coin_id.clone(),
                "sell".to_string(),
                target_price,
                quantity,
            ).await;

            // Update Strategy
            sqlx::query!(
                "UPDATE strategies SET current_coin_id = $2, current_order_id = $3, entry_price = $4 WHERE id = $1",
                strategy.id, best.coin_id, sell_order_id, best.current_price
            ).execute(&self.pool).await?;

            info!("✅ Strategy {}: Market buy completed, limit sell placed @ {} ({}% target)", 
                strategy.id, target_price, strategy.profit_percentage);

        } else {
            // No coin meets threshold, wait for next cycle
            info!("⏳ Strategy {}: No coins meet {}% threshold. Waiting for next cycle...", strategy.id, threshold_percent);
        }

        Ok(())
    }

    async fn analyze_coin(&self, coin_id: &str, current_price: Decimal) -> anyhow::Result<CoinAnalysis> {
        // Fetch order book data
        let order_book = self.fetch_order_book(coin_id).await?;

        // Calculate buy and sell pressure
        let buy_pressure: Decimal = order_book.bids.iter()
            .take(10) // Top 10 buy orders
            .map(|bid| {
                let price: Decimal = bid[0].parse().unwrap_or(Decimal::ZERO);
                let qty: Decimal = bid[1].parse().unwrap_or(Decimal::ZERO);
                price * qty
            })
            .sum();

        let sell_pressure: Decimal = order_book.asks.iter()
            .take(10) // Top 10 sell orders
            .map(|ask| {
                let price: Decimal = ask[0].parse().unwrap_or(Decimal::ZERO);
                let qty: Decimal = ask[1].parse().unwrap_or(Decimal::ZERO);
                price * qty
            })
            .sum();

        // Advanced calculation: Predict 10-second price
        // Formula: momentum = (buy_pressure - sell_pressure) / (buy_pressure + sell_pressure)
        // Predicted price = current_price * (1 + momentum * time_factor)
        let total_pressure = buy_pressure + sell_pressure;
        let momentum = if total_pressure > Decimal::ZERO {
            (buy_pressure - sell_pressure) / total_pressure
        } else {
            Decimal::ZERO
        };

        // Time factor for 10 seconds (assuming 1 second = 0.001 of momentum effect)
        // 0.01 = 1% price movement potential over 10 seconds
        let time_factor = Decimal::from(1) / Decimal::from(100); // 0.01
        let predicted_price_10s = current_price * (Decimal::ONE + momentum * time_factor);

        // Calculate percentage change
        let price_change = predicted_price_10s - current_price;
        let price_change_percent = if current_price > Decimal::ZERO {
            (price_change / current_price) * Decimal::from(100)
        } else {
            Decimal::ZERO
        };

        Ok(CoinAnalysis {
            coin_id: coin_id.to_string(),
            current_price,
            predicted_price_10s,
            price_change_percent,
            buy_pressure,
            sell_pressure,
        })
    }

    async fn fetch_order_book(&self, coin_id: &str) -> anyhow::Result<BinanceOrderBookResponse> {
        // Convert coin_id to Binance symbol (e.g., "btc" -> "BTCUSDT")
        let symbol = format!("{}USDT", coin_id.to_uppercase());
        
        let url = format!("https://api.binance.com/api/v3/depth?symbol={}&limit=20", symbol);
        
        let response = self.http_client
            .get(&url)
            .send()
            .await?;

        if !response.status().is_success() {
            // Try alternative symbol format or return error
            return Err(anyhow::anyhow!("Failed to fetch order book for {}", coin_id));
        }

        let order_book: BinanceOrderBookResponse = response.json().await?;
        Ok(order_book)
    }

    async fn log_action(&self, strategy_id: Uuid, action: &str, coin_id: &str, price: Decimal, amount: Decimal, profit: Option<Decimal>) -> anyhow::Result<()> {
        let quantity = amount / price;
        sqlx::query!(
            "INSERT INTO strategy_logs (strategy_id, action, coin_id, coin_symbol, price, quantity, amount, profit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            strategy_id, action, coin_id, coin_id.to_uppercase(), price, quantity, amount, profit
        ).execute(&self.pool).await?;
        Ok(())
    }

    async fn stop_strategy(&self, id: Uuid, reason: &str) -> anyhow::Result<()> {
        sqlx::query!("UPDATE strategies SET status = $2 WHERE id = $1", id, reason)
            .execute(&self.pool)
            .await?;
        info!("🛑 Strategy {} stopped: {}", id, reason);
        Ok(())
    }
}
