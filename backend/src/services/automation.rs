use crate::services::matching_engine::MatchingEngine;
use chrono::{DateTime, Utc};
use futures::stream::{self, StreamExt};
use reqwest::Client;
use rust_decimal::{Decimal, MathematicalOps};
use serde::Deserialize;
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::time::{sleep, Duration};
use tracing::{error, info, warn};
use crate::services::execution::execute_order;
use uuid::Uuid;
use std::str::FromStr;

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
    high_water_mark: Option<Decimal>,
    // Dynamic profit taking tracking
    profit_target_1_sold: Option<bool>, // 25% sold at +2%
    profit_target_2_sold: Option<bool>, // 25% sold at +4%
    profit_target_3_sold: Option<bool>, // 25% sold at +6%
    break_even_activated: Option<bool>, // Stop moved to break-even
}

#[derive(Debug, sqlx::FromRow)]
struct OrderStatusRow {
    order_status: String,
    order_type: String,
    price_per_unit: Option<Decimal>,
    quantity: Decimal,
}

#[derive(Debug, Deserialize)]
struct BinanceOrderBookResponse {
    bids: Vec<[String; 2]>, // [price, quantity]
    asks: Vec<[String; 2]>, // [price, quantity]
}

#[derive(Debug, Deserialize)]
#[allow(non_snake_case)]
struct BinanceTrade {
    #[allow(dead_code)]
    id: i64,
    price: String,
    qty: String,
    #[allow(dead_code)]
    quoteQty: String,
    #[allow(dead_code)]
    time: i64,
    isBuyerMaker: bool,
    #[allow(dead_code)]
    isBestMatch: bool,
}



#[derive(Debug, Clone)]
struct CoinAnalysis {
    coin_id: String,
    current_price: Decimal,
    predicted_price_10m: Decimal,
    price_change_percent: Decimal,
    rsi: Decimal, // RSI for filtering overbought coins
    #[allow(dead_code)]
    macd: Decimal, // MACD line
    #[allow(dead_code)]
    macd_signal: Decimal, // MACD signal line
    #[allow(dead_code)]
    macd_histogram: Decimal, // MACD histogram
    #[allow(dead_code)]
    support_level: Decimal, // Nearest support level (used in scoring)
    #[allow(dead_code)]
    resistance_level: Decimal, // Nearest resistance level
    volume_ratio: Decimal, // Current volume / 24h average volume
    entry_score: Decimal, // Combined entry confidence score (0-1)
    #[allow(dead_code)]
    buy_pressure: Decimal, // Total buy quantity * price
    #[allow(dead_code)]
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
        if let Err(e) =
            sqlx::query("ALTER TABLE strategies ADD COLUMN IF NOT EXISTS current_order_id uuid")
                .execute(&self.pool)
                .await
        {
            error!("⚠️ Failed to run runtime migration for strategies: {}", e);
        }
        
        // Add new fields for dynamic profit taking and break-even stop
        let migrations = vec![
            "ALTER TABLE strategies ADD COLUMN IF NOT EXISTS profit_target_1_sold BOOLEAN",
            "ALTER TABLE strategies ADD COLUMN IF NOT EXISTS profit_target_2_sold BOOLEAN",
            "ALTER TABLE strategies ADD COLUMN IF NOT EXISTS profit_target_3_sold BOOLEAN",
            "ALTER TABLE strategies ADD COLUMN IF NOT EXISTS break_even_activated BOOLEAN",
        ];
        
        for migration in migrations {
            if let Err(e) = sqlx::query(migration).execute(&self.pool).await {
                warn!("⚠️ Schema migration warning (may already exist): {} - {}", migration, e);
            }
        }

        // Ensure profit_percentage is DECIMAL (not Integer)
        if let Err(e) =
            sqlx::query("ALTER TABLE strategies ALTER COLUMN profit_percentage TYPE NUMERIC")
                .execute(&self.pool)
                .await
        {
             // Ignore error if it's just a type conversion issue to same type, but log it
             warn!("⚠️ Failed to enforce profit_percentage type: {}", e);
        }

        // 🛡️ CRITICAL FIX: Ensure orders table has high precision for low-value coins
        // (Prevents 0.07224 truncating to 0.07)
        if let Err(e) = sqlx::query("
            ALTER TABLE orders 
            ALTER COLUMN price_per_unit TYPE NUMERIC,
            ALTER COLUMN quantity TYPE NUMERIC,
            ALTER COLUMN total_amount TYPE NUMERIC
        ").execute(&self.pool).await {
            warn!("⚠️ Failed to enforce high precision on orders table: {}", e);
        }

        // Add high_water_mark for Trailing Stop
        if let Err(e) =
            sqlx::query("ALTER TABLE strategies ADD COLUMN IF NOT EXISTS high_water_mark NUMERIC")
                .execute(&self.pool)
                .await
        {
            warn!("⚠️ Failed to add high_water_mark column: {}", e);
        }


        let self_clone = self.clone();

        tokio::spawn(async move {
            let mut error_count = 0;
            loop {
                match self_clone.process_strategies().await {
                    Ok(_) => {
                        if error_count > 0 {
                            info!("✅ Automation Loop recovered.");
                            error_count = 0;
                        }
                        sleep(Duration::from_secs(2)).await; 
                    },
                    Err(e) => {
                        error!("❌ Automation Loop Error: {}", e);
                        error_count += 1;
                        // Simple linear backoff: 2s -> 5s -> 10s -> max 30s
                        let delay = if error_count > 5 {
                            30
                        } else if error_count > 2 {
                            10
                        } else {
                            5
                        };
                        warn!("⚠️ Network/DB stability issue. Retrying in {} seconds...", delay);
                        sleep(Duration::from_secs(delay)).await;
                    }
                }
            }
        });
    }

    async fn process_strategies(&self) -> anyhow::Result<()> {
        // 1. Fetch running strategies
        let strategies =
            sqlx::query_as::<_, Strategy>("SELECT * FROM strategies WHERE status = 'running'")
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
                    info!(
                        "⏰ Strategy {} reached time limit. Stopping immediately.",
                        strategy.id
                    );
                    self.stop_strategy(strategy.id, "completed").await?;
                    continue;
                }
            } else {
                // Calculate end_time if not set
                let end_time = strategy.start_time
                    + chrono::Duration::minutes(strategy.duration_minutes as i64);
                if Utc::now() >= end_time {
                    info!(
                        "⏰ Strategy {} reached time limit. Stopping immediately.",
                        strategy.id
                    );
                    self.stop_strategy(strategy.id, "completed").await?;
                    continue;
                }
            }

            // Check order count limit
            if strategy.iterations_completed >= strategy.total_iterations {
                info!(
                    "📊 Strategy {} reached order limit ({} orders). Stopping immediately.",
                    strategy.id, strategy.total_iterations
                );
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
                "SELECT * FROM strategies WHERE id = $1 AND status = 'running'",
            )
            .bind(strategy.id)
            .fetch_optional(&self.pool)
            .await?;

            let strategy = match current_strategy {
                Some(s) => s,
                None => {
                    info!("🛑 Skipping cycle for Strategy {} (Not Running)", strategy.id);
                    continue;
                }
            };

            if let Some(order_id) = strategy.current_order_id {
                // Monitor Active Order (Buy or Sell)
                self.check_order_status(&strategy, order_id).await?;
            } else if let Some(coin_id) = &strategy.current_coin_id {
                // Currently holding a coin, waiting for sell order
                self.handle_active_trade(&strategy, &prices, coin_id)
                    .await?;
            } else {
                // Not in a trade: Analyze ALL coins and find best opportunity
                self.handle_entry(&strategy, &prices).await?;
            }
        }

        Ok(())
    }

    async fn check_order_status(&self, strategy: &Strategy, order_id: Uuid) -> anyhow::Result<()> {
        let order = sqlx::query_as::<_, OrderStatusRow>(
            "SELECT order_status, order_type, price_per_unit, quantity FROM orders WHERE id = $1",
        )
        .bind(order_id)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(order) = order {
            if order.order_status == "completed" {
                if order.order_type == "buy" {
                    // BUY COMPLETED -> PLACE SELL IMMEDIATELY
                    let buy_price = order.price_per_unit.unwrap_or(Decimal::ZERO);
                    if buy_price <= Decimal::ZERO {
                        return Ok(());
                    }

                    let coin_id = strategy.current_coin_id.as_deref().unwrap_or("unknown");

                    info!(
                        "✅ Strategy {} Buy Complete @ {}. Placing Limit Sell immediately...",
                        strategy.id, buy_price
                    );

                    // Calculate Sell Target Price (buy_price * (1 + profit_percentage/100))
                    let multiplier =
                        Decimal::ONE + (strategy.profit_percentage / Decimal::from(100));
                    let target_price = buy_price * multiplier;

                    info!("CALC_DEBUG: Strategy {} BuyPrice: {}, Profit%: {}, Multiplier: {}, TargetPrice: {}", 
                        strategy.id, buy_price, strategy.profit_percentage, multiplier, target_price);

                    // Place Limit Sell Order IMMEDIATELY
                    let quantity = order.quantity;
                    let sell_order_id = Uuid::new_v4();

                    let total_amount = target_price * quantity;
                    sqlx::query(
                        "INSERT INTO orders (id, user_id, coin_id, coin_symbol, order_type, order_mode, quantity, price_per_unit, total_amount, order_status) VALUES ($1, $2, $3, $4, 'sell', 'limit', $5, $6, $7, 'pending')"
                    )
                    .bind(sell_order_id)
                    .bind(strategy.user_id)
                    .bind(coin_id)
                    .bind(coin_id.to_uppercase())
                    .bind(quantity)
                    .bind(target_price)
                    .bind(total_amount)
                    .execute(&self.pool).await?;

                    // Add to matching engine for immediate matching
                    self.matching_engine
                        .add_order(
                            sell_order_id.to_string(),
                            coin_id.to_string(),
                            "sell".to_string(),
                            target_price,
                            quantity,
                        )
                        .await;

                    // Update Strategy to track SELL order
                    sqlx::query(
                        "UPDATE strategies SET current_order_id = $2, entry_price = $3 WHERE id = $1"
                    )
                    .bind(strategy.id)
                    .bind(sell_order_id)
                    .bind(buy_price)
                    .execute(&self.pool).await?;

                    info!(
                        "🚀 Strategy {} Limit Sell Order Placed @ {} ({}% profit target)",
                        strategy.id, target_price, strategy.profit_percentage
                    );
                } else if order.order_type == "sell" {
                    // SELL COMPLETED -> FINISH ITERATION
                    info!(
                        "💰 Strategy {} Sell Complete. Profit Secured. Iteration {}/{}",
                        strategy.id,
                        strategy.iterations_completed + 1,
                        strategy.total_iterations
                    );

                    let sell_price = order.price_per_unit.unwrap_or_default();
                    let entry_price = strategy.entry_price.unwrap_or(sell_price);

                    // Log Profit
                    let quantity = order.quantity;
                    let profit = (sell_price - entry_price) * quantity;
                    let coin_id = strategy.current_coin_id.as_deref().unwrap_or("unknown");

                    self.log_action(
                        strategy.id,
                        "sell",
                        coin_id,
                        sell_price,
                        sell_price * quantity,
                        Some(profit),
                    )
                    .await?;

                    // Reset Strategy for next iteration
                    sqlx::query(
                        "UPDATE strategies SET current_coin_id = NULL, current_order_id = NULL, entry_price = NULL, iterations_completed = iterations_completed + 1 WHERE id = $1"
                    )
                    .bind(strategy.id)
                    .execute(&self.pool).await?;
                }
            } else if order.order_status == "cancelled" || order.order_status == "failed" {
                // Handle Cancelled/Failed Orders
                if order.order_type == "buy" {
                    info!(
                        "⚠️ Strategy {} Buy Order {} Cancelled/Failed. Resetting entry search.",
                        strategy.id, order_id
                    );
                    sqlx::query(
                        "UPDATE strategies SET current_coin_id = NULL, current_order_id = NULL, entry_price = NULL WHERE id = $1"
                    )
                    .bind(strategy.id)
                    .execute(&self.pool).await?;
                } else if order.order_type == "sell" {
                    info!(
                        "⚠️ Strategy {} Sell Order {} Cancelled/Failed. Resuming price monitoring.",
                        strategy.id, order_id
                    );
                    sqlx::query("UPDATE strategies SET current_order_id = NULL WHERE id = $1")
                        .bind(strategy.id)
                        .execute(&self.pool)
                        .await?;
                }
            }
        } else {
            info!(
                "⚠️ Strategy {} tracked order {} not found. Clearing track.",
                strategy.id, order_id
            );
            sqlx::query("UPDATE strategies SET current_order_id = NULL WHERE id = $1")
                .bind(strategy.id)
                .execute(&self.pool)
                .await?;
        }
        Ok(())
    }

    async fn handle_active_trade(
        &self,
        strategy: &Strategy,
        prices: &HashMap<String, Decimal>,
        coin_id: &str,
    ) -> anyhow::Result<()> {
        let current_price = match prices.get(coin_id) {
            Some(p) => *p,
            None => return Ok(()),
        };

        let entry_price = strategy.entry_price.unwrap_or_default();
        if entry_price <= Decimal::ZERO {
            return Ok(());
        }

        // --- TRAILING STOP LOGIC ---
        let mut high_water_mark = strategy.high_water_mark.unwrap_or(entry_price);
        
        // Update High Water Mark if current price is higher
        if current_price > high_water_mark {
            high_water_mark = current_price;
            // Update in DB
             sqlx::query("UPDATE strategies SET high_water_mark = $2 WHERE id = $1")
                .bind(strategy.id)
                .bind(high_water_mark)
                .execute(&self.pool)
                .await?;
        }

        let profit_pct = (current_price - entry_price) / entry_price * Decimal::from(100);
        let target_pct = strategy.profit_percentage;
        
        // Initialize profit target flags if not set
        // Note: These fields may not exist in DB yet, so we use unwrap_or(false)
        let profit_target_1_sold = strategy.profit_target_1_sold.unwrap_or(false);
        let profit_target_2_sold = strategy.profit_target_2_sold.unwrap_or(false);
        let profit_target_3_sold = strategy.profit_target_3_sold.unwrap_or(false);
        let _break_even_activated = strategy.break_even_activated.unwrap_or(false);
        
        // --- ATR TRAILING STOP LOGIC ---
        // Fetch Klines for ATR (15m candles context)
        let klines_atr = self.fetch_klines(coin_id, 20).await.unwrap_or_default();
        let atr = Self::calculate_atr(&klines_atr, 14);

        let stop_price = if profit_pct > Decimal::from_parts(5, 0, 0, false, 1) { // > 0.5% profit
             // TRAIL: HighWaterMark - 2 * ATR
             if atr > Decimal::ZERO {
                 let dynamic_stop = high_water_mark - (atr * Decimal::from(2));
                 // Sanity check: Don't let stop loss be ABOVE current price (impossible but good safety)
                 if dynamic_stop >= current_price {
                     current_price * Decimal::from_str("0.999").unwrap() // Tight close
                 } else {
                     dynamic_stop
                 }
             } else {
                 high_water_mark * Decimal::from_str("0.995").unwrap() // Fallback 0.5% trail
             }
        } else {
             // INITIAL STOP: Entry - 3 * ATR (Give it room to breathe)
             if atr > Decimal::ZERO {
                 entry_price - (atr * Decimal::from(3))
             } else {
                 entry_price * Decimal::from_str("0.97").unwrap() // Fallback 3% hard stop
             }
        };

        let target_price = entry_price * (Decimal::ONE + (target_pct / Decimal::from(100)));

        info!("🛡️ Strategy {} Monitoring: {} @ {} (Entry: {}, High: {}, Stop: {}, Target: {})", 
            strategy.id, coin_id, current_price, entry_price, high_water_mark, stop_price, target_price);

        let mut should_sell = false;
        let mut sell_reason = "";

        if current_price <= stop_price {
            should_sell = true;
            sell_reason = "Trailing Stop / Stop Loss Hit";
        } else if current_price >= target_price {
            should_sell = true;
            sell_reason = "Profit Target Hit";
        }

        if should_sell {
            info!(
                "🚨 Strategy {}: Selling remaining position {} @ {} ({})",
                strategy.id, coin_id, current_price, sell_reason
            );

            // Calculate remaining quantity (after partial sells)
            let total_quantity = strategy.amount / entry_price;
            let sold_quantity = if profit_target_1_sold { total_quantity * Decimal::from_str("0.25").unwrap() } else { Decimal::ZERO } +
                              if profit_target_2_sold { total_quantity * Decimal::from_str("0.25").unwrap() } else { Decimal::ZERO } +
                              if profit_target_3_sold { total_quantity * Decimal::from_str("0.25").unwrap() } else { Decimal::ZERO };
            let remaining_quantity = total_quantity - sold_quantity;
            
            if remaining_quantity > Decimal::ZERO {
                let order_id = Uuid::new_v4();
                let total_amount = current_price * remaining_quantity;

                sqlx::query(
                    "INSERT INTO orders (id, user_id, coin_id, coin_symbol, order_type, order_mode, quantity, price_per_unit, total_amount, order_status) VALUES ($1, $2, $3, $4, 'sell', 'market', $5, $6, $7, 'completed')"
                )
                .bind(order_id)
                .bind(strategy.user_id)
                .bind(coin_id)
                .bind(coin_id.to_uppercase())
                .bind(remaining_quantity)
                .bind(current_price)
                .bind(total_amount)
                .execute(&self.pool).await?;

                // Calculate total profit (including partial sells)
                let total_sell_amount = total_amount + sold_quantity * current_price; // Approximate partial sell value
                let profit = total_sell_amount - strategy.amount;
                
                self.log_action(
                    strategy.id,
                    "sell",
                    coin_id,
                    current_price,
                    total_amount,
                    Some(profit),
                )
                .await?;

                // Update user balance/holdings via execution service
                if let Err(e) = execute_order(&self.pool, order_id, current_price).await {
                    error!("❌ Failed to execute automation sell order {}: {}", order_id, e);
                }

                // Reset Strategy (including profit target flags)
                sqlx::query(
                    "UPDATE strategies SET current_coin_id = NULL, current_order_id = NULL, entry_price = NULL, high_water_mark = NULL, profit_target_1_sold = NULL, profit_target_2_sold = NULL, profit_target_3_sold = NULL, break_even_activated = NULL, iterations_completed = iterations_completed + 1 WHERE id = $1"
                )
                .bind(strategy.id)
                .execute(&self.pool).await?;

                info!("✅ Strategy {} Iteration Completed. Total Profit: {} (Partial sells + Final sell)", strategy.id, profit);
            }
        }

        Ok(())
    }

    async fn handle_entry(
        &self,
        strategy: &Strategy,
        _prices: &HashMap<String, Decimal>,
    ) -> anyhow::Result<()> {
        // ANALYZE TOP LIQUID COINS (Top 30 by Volume)
        info!(
            "🔍 Strategy {}: Fetching Top 30 High-Volume Coins...",
            strategy.id
        );

        let top_coins = self.matching_engine.get_top_volume_coins(30).await;

        let blacklisted_coins = vec![
            "usdc", "usdt", "fdusd", "dai", "tusd", "busd", "wbtc", "usdd",
            "btcup", "btcdown", "ethup", "ethdown", "bnbup", "bnbdown", "xrpup", "xrpdown", "linkup", "linkdown", "ltcup", "ltcdown"
        ];

        let filtered_coins: HashMap<String, crate::services::matching_engine::TickerData> = top_coins
            .into_iter()
            .filter(|(coin_id, data)| {
                 if blacklisted_coins.contains(&coin_id.as_str()) { return false; }
                 
                 // PRE-FILTER 1: Liquidity Check (> 1M USDT 24h Volume)
                 if data.volume_quote < Decimal::from(1_000_000) { return false; }

                 // PRE-FILTER 2: Momentum Check (RELAXED)
                 // We want coins that are MOVING, but also allow oversold coins (negative momentum)
                 // Oversold coins (down 1-5%) are good entry opportunities
                 let open = data.open_price;
                 let close = data.price;
                 if open <= Decimal::ZERO { return false; }
                 
                 let change_pct = (close - open) / open * Decimal::from(100);
                 // Allow coins that are:
                 // - Moving up (> 1%) - momentum
                 // - Moving down moderately (-1% to -5%) - oversold opportunity
                 // - Reject only sideways coins (< 1% change) or extreme dumps (< -5%)
                 if change_pct.abs() < Decimal::from(1) {
                      return false; // Skip boring side-ways coins
                 }
                 if change_pct < Decimal::from_str("-5").unwrap() {
                      return false; // Skip extreme dumps (might be crashing)
                 }
                 
                 true
            })
            .collect();

        info!("🛡️ Strategy {}: Optimized candidate list to {} coins (from 30)", strategy.id, filtered_coins.len());

        if filtered_coins.is_empty() {
            warn!(
                "⚠️ Strategy {}: No liquid coins found after filtering. Waiting for market data...",
                strategy.id
            );
            return Ok(());
        }

        // Fetch BTC Trend (Global Filter)
        let btc_trend = self.get_btc_trend().await.unwrap_or(Decimal::ZERO);
        if btc_trend < Decimal::from_str("-0.01").unwrap() {
            // Market Dump Warning! Abort/Cautious
            warn!("⚠️ Global Market Dump Detected (BTC Down). Pausing entries.");
            return Ok(());
        }

        // Parallel Analysis with Concurrency Limit (10 concurrent requests)
        let analyses = stream::iter(filtered_coins)
            .map(|(coin_id, ticker_data)| {
                let self_ref = &self;
                async move { self_ref.analyze_coin(&coin_id, ticker_data.price, ticker_data.open_price, btc_trend).await }
            })
            .buffer_unordered(10) // Limit concurrency to avoid IP bans
            .filter_map(|res| async { res.ok() })
            .collect::<Vec<_>>()
            .await;

        if analyses.is_empty() {
            warn!(
                "⚠️ Strategy {}: Analysis failed for all candidates. Skipping cycle.",
                strategy.id
            );
            return Ok(());
        }

        // ENHANCED: Multi-indicator entry system - buy LOW, sell HIGH
        // Use entry_score (0-1) to filter and rank opportunities
        let threshold_percent = strategy.profit_percentage;
        
        // FILTER: Require minimum entry score of 0.7 (70% confidence) AND volume confirmation
        let best_coin = analyses
            .iter()
            .filter(|a| {
                // CRITICAL: Don't buy overbought coins (RSI > 70) - they're at high prices
                if a.rsi > Decimal::from(70) {
                    return false; // Hard reject overbought
                }
                // Require minimum entry score (multi-indicator confirmation)
                if a.entry_score < Decimal::from_str("0.7").unwrap() {
                    return false; // Not enough confirmation
                }
                // Require volume confirmation (volume spike > 120%)
                if a.volume_ratio < Decimal::from_str("1.2").unwrap() {
                    return false; // Weak volume = weak signal
                }
                // Look for coins with positive potential (not predicted to crash)
                a.price_change_percent > Decimal::from_str("-5").unwrap()
            })
            .max_by(|a, b| {
                // Prioritize by entry_score first (highest confidence)
                let score_comparison = a.entry_score.cmp(&b.entry_score);
                if score_comparison != std::cmp::Ordering::Equal {
                    score_comparison
                } else {
                    // Then by lower RSI (more oversold = better entry)
                    b.rsi.cmp(&a.rsi)
                }
            });

        if let Some(best) = best_coin {
            info!("🎯 Strategy {}: Best opportunity found! {} predicted to increase {}% (Current: {}, Predicted 10m: {})", 
                strategy.id, best.coin_id, best.price_change_percent, best.current_price, best.predicted_price_10m);

            // ⚡ RACE CONDITION FIX: Re-check if strategy is still running before executing BUY
            let is_running = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM strategies WHERE id = $1 AND status = 'running')"
            )
            .bind(strategy.id)
            .fetch_one(&self.pool)
            .await
            .unwrap_or(false);

            if !is_running {
                warn!("🛑 Strategy {} was stopped during analysis. Aborting BUY order.", strategy.id);
                return Ok(());
            }

            // Place MARKET BUY order immediately
            let quantity = strategy.amount / best.current_price;
            let buy_order_id = Uuid::new_v4();

            info!(
                "💸 Strategy {}: Placing MARKET BUY for {} @ {} (Quantity: {})",
                strategy.id, best.coin_id, best.current_price, quantity
            );

            // Place market order (will execute immediately)
            sqlx::query(
                "INSERT INTO orders (id, user_id, coin_id, coin_symbol, order_type, order_mode, quantity, price_per_unit, total_amount, order_status) VALUES ($1, $2, $3, $4, 'buy', 'market', $5, $6, $7, 'completed')"
            )
            .bind(buy_order_id)
            .bind(strategy.user_id)
            .bind(&best.coin_id)
            .bind(best.coin_id.to_uppercase())
            .bind(quantity)
            .bind(best.current_price)
            .bind(strategy.amount)
            .execute(&self.pool).await?;

            // Log the buy action
            self.log_action(
                strategy.id,
                "buy",
                &best.coin_id,
                best.current_price,
                strategy.amount,
                None,
            )
            .await?;

            // Update user balance and holdings (simulate immediate execution)
            if let Err(e) = execute_order(&self.pool, buy_order_id, best.current_price).await {
                error!("❌ Failed to execute automation buy order {}: {}", buy_order_id, e);
                // Continue anyway, but log potential consistency issue
            }

            // --- TRAILING STOP SETUP (Active Monitoring) ---
            // Update strategy to track this active trade with NULL order_id (No fixed sell order)
            // Initialize High Water Mark = Entry Price
            
            sqlx::query(
                "UPDATE strategies SET current_coin_id = $2, current_order_id = NULL, entry_price = $3, high_water_mark = $3 WHERE id = $1"
            )
            .bind(strategy.id)
            .bind(&best.coin_id)
            .bind(best.current_price)
            .execute(&self.pool).await?;

            info!("✅ Strategy {} Entered Active Monitoring for {} @ {}", strategy.id, best.coin_id, best.current_price);
        } else {
            // No coin meets threshold, wait for next cycle
            info!(
                "⏳ Strategy {}: No coins meet {}% threshold. Waiting for next cycle...",
                strategy.id, threshold_percent
            );
        }

        Ok(())
    }

    async fn analyze_coin(
        &self,
        coin_id: &str,
        current_price: Decimal,
        open_price: Decimal,
        btc_trend_score: Decimal, // Passed from handle_entry
    ) -> anyhow::Result<CoinAnalysis> {
        // Fetch order book data
        let order_book = self.fetch_order_book(coin_id).await?;
        
        // Fetch recent trades
        let trades = match self.fetch_recent_trades(coin_id).await {
            Ok(t) => t,
            Err(e) => {
                warn!("⚠️ Failed to fetch trades for {}: {}", coin_id, e);
                Vec::new()
            }
        };

        // --- NEW: K-Line & Technical Indicators Analysis ---
        let klines = self.fetch_klines(coin_id, 30).await.unwrap_or_default();
        let rsi = Self::calculate_rsi(&klines, 14);
        
        // Calculate MACD
        let (macd, macd_signal, macd_histogram) = Self::calculate_macd(&klines);
        
        // Calculate Bollinger Bands
        let (_bb_upper, bb_middle, bb_lower) = Self::calculate_bollinger_bands(&klines, 20, Decimal::from(2));
        
        // Detect Support and Resistance
        let (support_level, resistance_level) = Self::detect_support_resistance(&klines, 20);
        
        // Filter: Don't buy if RSI > 70 (Overbought) - STRONG penalty
        // Boost: Buy if RSI < 30 (Oversold Bounce candidate) - STRONG boost
        let rsi_bias = if rsi > Decimal::from(70) {
            Decimal::from_str("-0.10").unwrap() // -10% penalty (strong rejection of overbought)
        } else if rsi < Decimal::from(30) {
             Decimal::from_str("0.05").unwrap() // +5% boost (strong preference for oversold)
        } else if rsi < Decimal::from(45) {
             Decimal::from_str("0.02").unwrap() // +2% boost for slightly oversold
        } else {
             Decimal::ZERO
        };


        // --- NEW: VWAP Analysis ---
        let mut total_vol = Decimal::ZERO;
        let mut vol_price_sum = Decimal::ZERO;
        for t in &trades {
             let p: Decimal = t.price.parse().unwrap_or_default();
             let q: Decimal = t.qty.parse().unwrap_or_default();
             total_vol += q;
             vol_price_sum += p * q;
        }
        let vwap = if total_vol > Decimal::ZERO { vol_price_sum / total_vol } else { current_price };
        
        // Calculate volume ratio (current volume vs 24h average)
        // Approximate 24h average from ticker data (would need actual 24h volume from API)
        let avg_volume_24h = if total_vol > Decimal::ZERO {
            total_vol * Decimal::from(1440) // Approximate: 1m volume * minutes in day
        } else {
            Decimal::from(1_000_000) // Fallback
        };
        let volume_ratio = if avg_volume_24h > Decimal::ZERO {
            total_vol / avg_volume_24h * Decimal::from(1440) // Normalize to ratio
        } else {
            Decimal::ONE
        };
        
        // If Price < VWAP, it might be undervalued (Good entry) - STRONG preference
        // If Price > VWAP, it might be overextended - STRONG penalty
        let vwap_bias = if current_price < vwap {
             Decimal::from_str("0.03").unwrap() // +3% boost for undervalued (below VWAP)
        } else {
             Decimal::from_str("-0.02").unwrap() // -2% penalty for overvalued (above VWAP)
        };


        // Calculate buy and sell pressure from ORDER BOOK (Wall Detection)
        let mut buy_pressure = Decimal::ZERO;
        let mut sell_pressure = Decimal::ZERO;
        let mut resistance_wall_detected = false;
        
        // Identify Walls (Liquidity > 5x average)
        let mut total_ask_qty = Decimal::ZERO;
        for ask in order_book.asks.iter().take(20) {
             let qty: Decimal = ask[1].parse().unwrap_or_default();
             total_ask_qty += qty;
        }
        let avg_ask_qty = total_ask_qty / Decimal::from(20);

        for ask in order_book.asks.iter().take(10) {
            let price: Decimal = ask[0].parse().unwrap_or_default();
            let qty: Decimal = ask[1].parse().unwrap_or_default();
            
            // Check for Wall
            if qty > avg_ask_qty * Decimal::from(5) {
                // Large Sell Wall near current price? Bad.
                resistance_wall_detected = true;
            }
            sell_pressure += price * qty;
        }
        
        let wall_bias = if resistance_wall_detected {
             Decimal::from_str("-0.05").unwrap() // -5% penalty (Huge!)
        } else {
             Decimal::ZERO
        };

        for bid in order_book.bids.iter().take(10) {
            let price: Decimal = bid[0].parse().unwrap_or_default();
            let qty: Decimal = bid[1].parse().unwrap_or_default();
            buy_pressure += price * qty;
        }

        // --- OLD LOGIC with Integration ---
        
        let mut min_price = Decimal::MAX;
        let mut max_price = Decimal::ZERO;
        let mut sum_price = Decimal::ZERO;
        let mut trade_count = 0;
        let mut trade_buy_vol = Decimal::ZERO;
        let mut trade_sell_vol = Decimal::ZERO;

        for trade in &trades {
            let qty: Decimal = trade.qty.parse().unwrap_or(Decimal::ZERO);
            let price: Decimal = trade.price.parse().unwrap_or(Decimal::ZERO);
            let vol = price * qty;
            
            if price < min_price { min_price = price; }
            if price > max_price { max_price = price; }
            sum_price += price;
            trade_count += 1;

            if trade.isBuyerMaker {
                trade_sell_vol += vol;
            } else {
                trade_buy_vol += vol;
            }
        }
        
        let volatility_pct = if max_price > Decimal::ZERO && min_price < Decimal::MAX {
             (max_price - min_price) / min_price
        } else {
             Decimal::ZERO
        };

        let avg_price = if trade_count > 0 { sum_price / Decimal::from(trade_count) } else { current_price };
        // FIXED: Reverse logic - favor coins BELOW average (undervalued), not above (overbought)
        let velocity_bias = if current_price < avg_price {
             Decimal::from_parts(2, 0, 0, false, 2) // +2% boost for undervalued
        } else {
             Decimal::from_parts(1, 0, 0, true, 2) // -1% penalty for overvalued
        };

        let total_pressure = buy_pressure + sell_pressure;
        let ob_momentum = if total_pressure > Decimal::ZERO {
            (buy_pressure - sell_pressure) / total_pressure
        } else {
             Decimal::ZERO
        };

        let total_trade_vol = trade_buy_vol + trade_sell_vol;
        let trade_momentum = if total_trade_vol > Decimal::ZERO {
            (trade_buy_vol - trade_sell_vol) / total_trade_vol
        } else {
             Decimal::ZERO
        };

        let trend_24h = if open_price > Decimal::ZERO {
             (current_price - open_price) / open_price
        } else {
             Decimal::ZERO
        };

        // Weights (Tuned for 10m Horizon)
        // Order Book noise is less relevant for 10m, Trend is more important
        let ob_factor = Decimal::from_parts(5, 0, 0, false, 3); // 0.005 (Reduced from 0.01)
        let trend_factor = Decimal::from_parts(6, 0, 0, false, 1); // 0.6 (Increased from 0.5)
        let trade_factor = Decimal::from_parts(1, 0, 0, false, 1); // 0.1

        let base_momentum = (ob_momentum * ob_factor) + (trend_24h * trend_factor) + (trade_momentum * trade_factor);
        
        let volatility_scaler = if volatility_pct > Decimal::ZERO { volatility_pct * Decimal::from(10) } else { Decimal::ZERO }; 
        
        let combined_bias = (base_momentum + velocity_bias + rsi_bias + vwap_bias + wall_bias + btc_trend_score) * volatility_scaler;
        
        // Project 10 minutes out
        let time_scaler = Decimal::from(10); 
        let predicted_bias = combined_bias * time_scaler;

        let predicted_price_10m = current_price * (Decimal::ONE + predicted_bias);

        let price_change = predicted_price_10m - current_price;
        let price_change_percent = if current_price > Decimal::ZERO {
            (price_change / current_price) * Decimal::from(100)
        } else {
            Decimal::ZERO
        };
        
        // --- MULTI-INDICATOR ENTRY SCORING SYSTEM ---
        // Score each indicator (0-1 scale), then weight them
        let rsi_score = if rsi < Decimal::from(30) {
            Decimal::ONE // Perfect oversold
        } else if rsi < Decimal::from(45) {
            Decimal::from_str("0.7").unwrap() // Good oversold
        } else if rsi < Decimal::from(55) {
            Decimal::from_str("0.5").unwrap() // Neutral
        } else if rsi < Decimal::from(70) {
            Decimal::from_str("0.3").unwrap() // Overbought warning
        } else {
            Decimal::ZERO // Reject overbought
        };
        
        // MACD Score (bullish crossover = good)
        let macd_score = if macd > macd_signal && macd_histogram > Decimal::ZERO {
            Decimal::ONE // Bullish crossover
        } else if macd > macd_signal {
            Decimal::from_str("0.6").unwrap() // Above signal but histogram negative
        } else {
            Decimal::from_str("0.2").unwrap() // Bearish
        };
        
        // Bollinger Bands Score (price near lower band = oversold = good)
        let bb_score = if bb_lower > Decimal::ZERO && current_price <= bb_lower * Decimal::from_str("1.01").unwrap() {
            Decimal::ONE // Touching lower band (oversold)
        } else if current_price < bb_middle {
            Decimal::from_str("0.6").unwrap() // Below middle (good)
        } else {
            Decimal::from_str("0.3").unwrap() // Above middle (less ideal)
        };
        
        // Volume Score (volume spike = confirmation)
        let volume_score = if volume_ratio > Decimal::from_str("1.5").unwrap() {
            Decimal::ONE // Strong volume spike (>150%)
        } else if volume_ratio > Decimal::from_str("1.2").unwrap() {
            Decimal::from_str("0.7").unwrap() // Good volume (>120%)
        } else if volume_ratio > Decimal::ONE {
            Decimal::from_str("0.5").unwrap() // Average volume
        } else {
            Decimal::from_str("0.2").unwrap() // Low volume (weak)
        };
        
        // Support Level Score (near support = good entry)
        let mut support_score = Decimal::ZERO;
        if support_level > Decimal::ZERO {
            let distance_to_support = ((current_price - support_level) / support_level).abs();
            if distance_to_support < Decimal::from_str("0.01").unwrap() {
                support_score = Decimal::ONE; // Within 1% of support (perfect)
            } else if distance_to_support < Decimal::from_str("0.02").unwrap() {
                support_score = Decimal::from_str("0.7").unwrap(); // Within 2% (good)
            } else if distance_to_support < Decimal::from_str("0.05").unwrap() {
                support_score = Decimal::from_str("0.4").unwrap(); // Within 5% (okay)
            } else {
                support_score = Decimal::from_str("0.1").unwrap(); // Far from support (poor)
            }
        }
        
        // Calculate weighted entry score
        let entry_score = (rsi_score * Decimal::from_str("0.25").unwrap()) +
                         (macd_score * Decimal::from_str("0.20").unwrap()) +
                         (bb_score * Decimal::from_str("0.15").unwrap()) +
                         (volume_score * Decimal::from_str("0.20").unwrap()) +
                         (support_score * Decimal::from_str("0.20").unwrap());
        
        if price_change_percent > Decimal::from(1) || entry_score > Decimal::from_str("0.7").unwrap() {
            info!("🔬 Analysis {}: RSI: {}, MACD: {:.4}, BB: {:.2}, Vol: {:.2}x, Support: {:.2}, Entry Score: {:.2}, Total%: {}", 
                coin_id, rsi, macd, bb_lower, volume_ratio, support_level, entry_score, price_change_percent);
        }

        Ok(CoinAnalysis {
            coin_id: coin_id.to_string(),
            current_price,
            predicted_price_10m,
            price_change_percent,
            rsi,
            macd,
            macd_signal,
            macd_histogram,
            support_level,
            resistance_level,
            volume_ratio,
            entry_score,
            buy_pressure,
            sell_pressure,
        })
    }

    async fn fetch_order_book(&self, coin_id: &str) -> anyhow::Result<BinanceOrderBookResponse> {
        let symbol = format!("{}USDT", coin_id.to_uppercase());
        let url = format!(
            "https://api.binance.com/api/v3/depth?symbol={}&limit=20",
            symbol
        );

        let response = self.http_client.get(&url).send().await?;

        if !response.status().is_success() {
            return Err(anyhow::anyhow!(
                "Failed to fetch order book for {}",
                coin_id
            ));
        }

        let order_book: BinanceOrderBookResponse = response.json().await?;
        Ok(order_book)
    }

    async fn fetch_recent_trades(&self, coin_id: &str) -> anyhow::Result<Vec<BinanceTrade>> {
        let symbol = format!("{}USDT", coin_id.to_uppercase());
        let url = format!(
            "https://api.binance.com/api/v3/trades?symbol={}&limit=50",
            symbol
        );

        let response = self.http_client.get(&url).send().await?;

        if !response.status().is_success() {
            return Err(anyhow::anyhow!(
                "Failed to fetch trades for {}",
                coin_id
            ));
        }

        let trades: Vec<BinanceTrade> = response.json().await?;
        Ok(trades)
    }

    async fn fetch_klines(&self, coin_id: &str, limit: usize) -> anyhow::Result<Vec<Decimal>> {
        let symbol = format!("{}USDT", coin_id.to_uppercase());
        // Fetch 1m candles
        let url = format!(
            "https://api.binance.com/api/v3/klines?symbol={}&interval=1m&limit={}",
            symbol, limit
        );

        let response = self.http_client.get(&url).send().await?;
        
        if !response.status().is_success() {
             return Ok(Vec::new()); // Fail gracefully
        }

        // Binance returns array of arrays. We need to parse custom logic or use generic Value
        let raw_klines: Vec<serde_json::Value> = response.json().await?;
        
        let closes: Vec<Decimal> = raw_klines.iter().filter_map(|k| {
            // Index 4 is Close Price
            k.get(4).and_then(|v| v.as_str()).and_then(|s| s.parse::<Decimal>().ok())
        }).collect();

        Ok(closes)
    }

    fn calculate_rsi(prices: &[Decimal], period: usize) -> Decimal {
        if prices.len() <= period {
            return Decimal::from(50); // Not enough data, return neutral
        }

        let mut gains = Decimal::ZERO;
        let mut losses = Decimal::ZERO;

        // Calculate initial Average Gain/Loss
        for i in 1..=period {
            let change = prices[i] - prices[i-1];
            if change > Decimal::ZERO {
                gains += change;
            } else {
                losses += change.abs();
            }
        }

        let mut avg_gain = gains / Decimal::from(period);
        let mut avg_loss = losses / Decimal::from(period);

        // Calculate smoothed averages for remainder
        for i in (period + 1)..prices.len() {
             let change = prices[i] - prices[i-1];
             let (gain, loss) = if change > Decimal::ZERO {
                 (change, Decimal::ZERO)
             } else {
                 (Decimal::ZERO, change.abs())
             };
             
             avg_gain = (avg_gain * Decimal::from(period - 1) + gain) / Decimal::from(period);
             avg_loss = (avg_loss * Decimal::from(period - 1) + loss) / Decimal::from(period);
        }

        if avg_loss == Decimal::ZERO {
            return Decimal::from(100);
        }

        let rs = avg_gain / avg_loss;
        let rsi = Decimal::from(100) - (Decimal::from(100) / (Decimal::ONE + rs));
        
        rsi
    }

    fn calculate_atr(prices: &[Decimal], period: usize) -> Decimal {
        if prices.len() <= period {
            return Decimal::ZERO;
        }

        let mut tr_sum = Decimal::ZERO;

        // Simple ATR (Average True Range) approximation using just High-Low (since we only have Close here really, but let's approximate with Close volatility)
        // Wait, fetch_klines only returns CLOSES. 
        // True Range needs High/Low/Close.
        // As a fallback for "Close-only" data: We used Absolute Change.
        
        for i in 1..prices.len() {
             let change = (prices[i] - prices[i-1]).abs();
             tr_sum += change;
        }
        
        let avg_tr = tr_sum / Decimal::from(prices.len() - 1);
        avg_tr
    }

    // Calculate EMA (Exponential Moving Average)
    fn calculate_ema(prices: &[Decimal], period: usize) -> Decimal {
        if prices.is_empty() {
            return Decimal::ZERO;
        }
        if prices.len() == 1 {
            return prices[0];
        }

        let multiplier = Decimal::from(2) / Decimal::from(period + 1);
        let mut ema = prices[0];

        for i in 1..prices.len() {
            ema = (prices[i] - ema) * multiplier + ema;
        }

        ema
    }

    // Calculate MACD (Moving Average Convergence Divergence)
    fn calculate_macd(prices: &[Decimal]) -> (Decimal, Decimal, Decimal) {
        // MACD = EMA(12) - EMA(26)
        // Signal = EMA(9) of MACD
        // Histogram = MACD - Signal
        
        if prices.len() < 26 {
            return (Decimal::ZERO, Decimal::ZERO, Decimal::ZERO);
        }

        // Calculate EMA(12) and EMA(26)
        let ema12 = Self::calculate_ema(prices, 12);
        let ema26 = Self::calculate_ema(prices, 26);
        let macd_line = ema12 - ema26;

        // For signal line, we need MACD values over time, but we'll approximate
        // by using a shorter period EMA of recent price changes
        let recent_prices: Vec<Decimal> = prices.iter().rev().take(9).cloned().collect();
        let _signal_line = Self::calculate_ema(&recent_prices, 9);
        
        // Approximate signal as EMA of MACD by using price momentum
        let signal_approx = if macd_line > Decimal::ZERO {
            macd_line * Decimal::from_str("0.7").unwrap() // Approximate
        } else {
            macd_line * Decimal::from_str("0.7").unwrap()
        };

        let histogram = macd_line - signal_approx;

        (macd_line, signal_approx, histogram)
    }

    // Calculate Bollinger Bands
    fn calculate_bollinger_bands(prices: &[Decimal], period: usize, std_dev: Decimal) -> (Decimal, Decimal, Decimal) {
        if prices.len() < period {
            let avg = if prices.is_empty() { Decimal::ZERO } else {
                prices.iter().sum::<Decimal>() / Decimal::from(prices.len())
            };
            return (avg, avg, avg);
        }

        let recent: Vec<Decimal> = prices.iter().rev().take(period).cloned().collect();
        let sma = recent.iter().sum::<Decimal>() / Decimal::from(period);

        // Calculate standard deviation
        let variance = recent.iter()
            .map(|p| {
                let diff = *p - sma;
                diff * diff
            })
            .sum::<Decimal>() / Decimal::from(period);
        
        let std = variance.sqrt().unwrap_or(Decimal::ZERO);
        let upper_band = sma + (std * std_dev);
        let lower_band = sma - (std * std_dev);

        (upper_band, sma, lower_band)
    }

    // Detect support and resistance levels
    fn detect_support_resistance(prices: &[Decimal], lookback: usize) -> (Decimal, Decimal) {
        if prices.len() < lookback {
            let current = prices.last().copied().unwrap_or(Decimal::ZERO);
            return (current * Decimal::from_str("0.98").unwrap(), current * Decimal::from_str("1.02").unwrap());
        }

        let recent: Vec<Decimal> = prices.iter().rev().take(lookback).cloned().collect();
        
        // Support = lowest low in lookback period
        let support = recent.iter().min().copied().unwrap_or(Decimal::ZERO);
        
        // Resistance = highest high in lookback period
        let resistance = recent.iter().max().copied().unwrap_or(Decimal::ZERO);

        (support, resistance)
    }

    async fn get_btc_trend(&self) -> anyhow::Result<Decimal> {
         let klines = self.fetch_klines("BTC", 5).await?;
         if klines.len() < 5 {
             return Ok(Decimal::ZERO);
         }
         
         let current = klines.last().unwrap();
         let start = klines.first().unwrap();
         
         let trend = (current - start) / start;
         Ok(trend)
    }

    async fn log_action(
        &self,
        strategy_id: Uuid,
        action: &str,
        coin_id: &str,
        price: Decimal,
        amount: Decimal,
        profit: Option<Decimal>,
    ) -> anyhow::Result<()> {
        let quantity = amount / price;
        sqlx::query(
            "INSERT INTO strategy_logs (strategy_id, action, coin_id, coin_symbol, price, quantity, amount, profit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"
        )
        .bind(strategy_id)
        .bind(action)
        .bind(coin_id)
        .bind(coin_id.to_uppercase())
        .bind(price)
        .bind(quantity)
        .bind(amount)
        .bind(profit)
        .execute(&self.pool).await?;
        Ok(())
    }

    pub async fn force_exit_strategy(&self, id: Uuid) -> anyhow::Result<()> {
        info!("🚨 FORCE EXIT requested for strategy {}", id);

        // 1. Fetch Strategy
        let strategy = sqlx::query_as::<_, Strategy>("SELECT * FROM strategies WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;

        let strategy = match strategy {
            Some(s) => s,
            None => {
                warn!("Strategy {} not found for force exit", id);
                return Ok(());
            }
        };

        // 2. Cancel Pending Order if exists
        if let Some(order_id) = strategy.current_order_id {
            info!("Cancelling pending order {}", order_id);
            sqlx::query("UPDATE orders SET order_status = 'cancelled' WHERE id = $1")
                .bind(order_id)
                .execute(&self.pool)
                .await?;
        }

        // 3. Sell Active Position if exists
        if let Some(coin_id) = &strategy.current_coin_id {
            if let Some(entry_price) = strategy.entry_price {
                 if entry_price > Decimal::ZERO {
                    // Fetch current price to estimate return (optional, matching engine handles execution price)
                    // Just place Market Sell
                    let prices = self.matching_engine.get_prices().await;
                    let current_price = prices.get(coin_id).cloned().unwrap_or(entry_price);

                    let quantity = strategy.amount / entry_price;
                    let sell_order_id = Uuid::new_v4();
                    let total_amount = current_price * quantity;

                    info!("Placing FORCE MARKET SELL for {} {}", quantity, coin_id);
                    
                    sqlx::query(
                        "INSERT INTO orders (id, user_id, coin_id, coin_symbol, order_type, order_mode, quantity, price_per_unit, total_amount, order_status) VALUES ($1, $2, $3, $4, 'sell', 'market', $5, $6, $7, 'pending')"
                    )
                    .bind(sell_order_id)
                    .bind(strategy.user_id)
                    .bind(coin_id)
                    .bind(coin_id.to_uppercase())
                    .bind(quantity)
                    .bind(current_price)
                    .bind(total_amount)
                    .execute(&self.pool).await?;

                    // Add to matching engine
                    self.matching_engine
                        .add_order(
                            sell_order_id.to_string(),
                            coin_id.to_string(),
                            "sell".to_string(),
                            current_price, // For market order, this might be treated as limit in current simple engine, but let's hope it executes against current price
                            quantity,
                        )
                        .await;
                    
                    // Log the Panic Sell
                    self.log_action(
                        strategy.id,
                        "sell_force",
                        coin_id,
                        current_price,
                        total_amount,
                        Some(total_amount - strategy.amount), // approx profit/loss
                    ).await?;
                 }
            }
        }

        // 4. Stop Strategy
        self.stop_strategy(id, "force_stopped").await?;

        Ok(())
    }

    async fn stop_strategy(&self, id: Uuid, reason: &str) -> anyhow::Result<()> {
        sqlx::query("UPDATE strategies SET status = $2 WHERE id = $1")
            .bind(id)
            .bind(reason)
            .execute(&self.pool)
            .await?;
        info!("🛑 Strategy {} stopped: {}", id, reason);
        Ok(())
    }
}
