use futures::StreamExt;
use rust_decimal::Decimal;
use serde::Deserialize;
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use tracing::{error, info};
use url::Url;
use uuid::Uuid;

#[derive(Clone)]
pub struct MatchingEngine {
    pool: PgPool,
    orders: Arc<Mutex<HashMap<String, Vec<LimitOrder>>>>, // CoinID -> Orders
    prices: Arc<Mutex<HashMap<String, Decimal>>>,         // CoinID -> Latest Price
    ticker_data: Arc<Mutex<HashMap<String, TickerData>>>, // CoinID -> Volume & Price Data
}

#[derive(Debug, Clone)]
pub struct TickerData {
    pub price: Decimal,
    pub volume_quote: Decimal, // 'q' from Binance (USDT volume)
    pub open_price: Decimal,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
struct LimitOrder {
    id: String,
    user_id: String,
    coin_id: String,
    coin_symbol: String,
    order_type: String, // "buy" or "sell"
    quantity: Decimal,
    price: Decimal,
}

#[derive(Debug, Deserialize)]
struct BinanceTicker {
    s: String, // Symbol
    c: String, // Close price
    q: String, // Quote Asset Volume
    o: String, // Open price
}

impl MatchingEngine {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            orders: Arc::new(Mutex::new(HashMap::new())),
            prices: Arc::new(Mutex::new(HashMap::new())),
            ticker_data: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn start(&self) {
        info!("🚀 Starting High-Performance Matching Engine...");

        // 1. Load initial pending orders
        if let Err(e) = self.load_pending_orders().await {
            error!("Failed to load pending orders: {}", e);
            return;
        }

        // 2. Connect to Binance WebSocket
        let orders_clone = self.orders.clone();
        let prices_clone = self.prices.clone(); // Clone for WebSocket task
        let ticker_data_clone = self.ticker_data.clone();
        let pool_clone = self.pool.clone();

        tokio::spawn(async move {
            loop {
                // Binance Mini Ticker Stream for ALL symbols
                let url = Url::parse("wss://stream.binance.com:9443/ws/!miniTicker@arr").unwrap();

                info!("Connecting to Binance WebSocket...");
                match connect_async(url).await {
                    Ok((ws_stream, _)) => {
                        info!("✅ Connected to Binance WebSocket. Listening for price updates...");
                        let (_, mut read) = ws_stream.split();

                        while let Some(message) = read.next().await {
                            if let Ok(Message::Text(text)) = message {
                                let start = Instant::now();
                                if let Ok(tickers) =
                                    serde_json::from_str::<Vec<BinanceTicker>>(&text)
                                {
                                    let mut orders = orders_clone.lock().await;

                                    // Batch update ticker data for efficiency
                                    let mut new_ticker_data = Vec::with_capacity(tickers.len());

                                    for ticker in tickers {
                                        let symbol = ticker.s.to_lowercase();
                                        // Only care about USDT pairs
                                        if !symbol.ends_with("usdt") {
                                            continue;
                                        }

                                        let coin_id = symbol.replace("usdt", "");

                                        if let (Ok(current_price), Ok(volume_quote), Ok(open_price)) = (
                                            ticker.c.parse::<Decimal>(),
                                            ticker.q.parse::<Decimal>(),
                                            ticker.o.parse::<Decimal>(),
                                        ) {
                                            // Store data for analysis
                                            new_ticker_data.push((
                                                coin_id.clone(),
                                                TickerData {
                                                    price: current_price,
                                                    volume_quote,
                                                    open_price,
                                                },
                                            ));

                                            // Update Price Store (Legacy support)
                                            {
                                                let mut prices_map = prices_clone.lock().await;
                                                prices_map.insert(coin_id.clone(), current_price);
                                            }

                                            if let Some(coin_orders) = orders.get_mut(&coin_id) {
                                                // ⚡ CRITICAL SECTION: MATCHING LOGIC
                                                let mut executed_indices = Vec::new();

                                                for (i, order) in coin_orders.iter().enumerate() {
                                                    let is_match = match order.order_type.as_str() {
                                                        "buy" => current_price <= order.price,
                                                        "sell" => current_price >= order.price,
                                                        _ => false,
                                                    };

                                                    if is_match {
                                                        info!("⚡ MATCHED: Order {} {} @ {} (Market: {}) in {:?}", 
                                                            order.id, order.order_type, order.price, current_price, start.elapsed());

                                                        // Execute async (fire and forget from matching loop perspective)
                                                        let p_clone = pool_clone.clone();
                                                        let o_clone = order.clone();
                                                        let exec_price = current_price;

                                                        tokio::spawn(async move {
                                                            Self::execute_order(
                                                                p_clone, o_clone, exec_price,
                                                            )
                                                            .await;
                                                        });

                                                        executed_indices.push(i);
                                                    }
                                                }

                                                // Remove executed orders (reverse to safely remove)
                                                for &i in executed_indices.iter().rev() {
                                                    coin_orders.remove(i);
                                                }
                                            }
                                        }
                                    }

                                    // Update Ticker Data Store
                                    if !new_ticker_data.is_empty() {
                                        let mut td_map = ticker_data_clone.lock().await;
                                        for (cid, data) in new_ticker_data {
                                            td_map.insert(cid, data);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        error!("WebSocket connection failed: {}. Retrying in 5s...", e);
                        tokio::time::sleep(Duration::from_secs(5)).await;
                    }
                }
            }
        });
    }

    async fn load_pending_orders(&self) -> anyhow::Result<()> {
        #[derive(sqlx::FromRow)]
        struct PendingOrderRow {
            id: Uuid,
            user_id: Uuid,
            coin_id: String,
            coin_symbol: String,
            order_type: String,
            quantity: Decimal,
            price_per_unit: Option<Decimal>,
        }

        let rows = sqlx::query_as::<_, PendingOrderRow>(
            r#"
            SELECT id, user_id, coin_id, coin_symbol, order_type, quantity, price_per_unit 
            FROM orders 
            WHERE order_status = 'pending' AND order_mode = 'limit'
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let mut orders_map = self.orders.lock().await;
        for row in rows {
            // Handle fields derived from non-nullable DB columns
            let coin_id = row.coin_id.trim().to_lowercase();
            let quantity = row.quantity;
            let price = row.price_per_unit.unwrap_or_default();

            if price <= Decimal::ZERO {
                tracing::warn!(
                    "⚠️ Skipping Pending Order {} with invalid price: {}",
                    row.id,
                    price
                );
                continue;
            }

            let order = LimitOrder {
                id: row.id.to_string(),
                user_id: row.user_id.to_string(),
                coin_id: coin_id.clone(),
                coin_symbol: row.coin_symbol,
                order_type: row.order_type,
                quantity,
                price,
            };
            orders_map
                .entry(coin_id)
                .or_insert_with(Vec::new)
                .push(order);
        }

        info!(
            "Loaded {} pending limit orders into memory",
            orders_map.values().map(|v| v.len()).sum::<usize>()
        );
        Ok(())
    }

    async fn execute_order(pool: PgPool, order: LimitOrder, execution_price: Decimal) {
        let total_amount = execution_price * order.quantity;

        // Parse UUID string to Uuid type for sqlx
        let order_uuid = match Uuid::parse_str(&order.id) {
            Ok(uuid) => uuid,
            Err(e) => {
                error!("Invalid UUID for order {}: {}", order.id, e);
                return;
            }
        };

        let result = sqlx::query(
            r#"
            UPDATE orders 
            SET order_status = 'completed', 
                price_per_unit = $1, 
                total_amount = $2, 
                completed_at = NOW()
            WHERE id = $3
            "#,
        )
        .bind(execution_price)
        .bind(total_amount)
        .bind(order_uuid)
        .execute(&pool)
        .await;

        match result {
            Ok(_) => {
                info!("✅ Order {} executed successfully in DB", order.id);

                // 🚀 Execute Financial Transaction (Direct DB)
                // Use token::spawn to run in background, but we need a new connection/pool reference
                 let p_clone_exec = pool.clone();
                 let order_id = order_uuid;
                 let e_price = execution_price;
                 
                 tokio::spawn(async move {
                    if let Err(e) = crate::services::execution::execute_order(&p_clone_exec, order_id, e_price).await {
                        error!("❌ Financial Execution Failed for order {}: {}", order_id, e);
                    } else {
                        info!("💸 Financial Transaction executed for Order {}", order_id);
                    }
                 });
            }
            Err(e) => error!("❌ Failed to update order {} in DB: {}", order.id, e),
        }
    }

    // Public method to add new order dynamically (called from API)
    pub async fn add_order(
        &self,
        order_id: String,
        coin_id: String,
        order_type: String,
        price: Decimal,
        quantity: Decimal,
    ) {
        if price <= Decimal::ZERO {
            tracing::warn!(
                "⚠️ Attempted to add order {} with invalid price: {}",
                order_id,
                price
            );
            return;
        }
        let mut orders = self.orders.lock().await;
        orders
            .entry(coin_id.trim().to_lowercase())
            .or_insert_with(Vec::new)
            .push(LimitOrder {
                id: order_id,
                user_id: "".to_string(), // Fetched if needed
                coin_id,
                coin_symbol: "".to_string(),
                order_type,
                quantity,
                price,
            });
    }

    pub async fn get_prices(&self) -> HashMap<String, Decimal> {
        let prices = self.prices.lock().await;
        prices.clone()
    }

    // NEW: Get Top liquid coins for analysis
    pub async fn get_top_volume_coins(&self, limit: usize) -> Vec<(String, TickerData)> {
        let ticker_map = self.ticker_data.lock().await;

        let mut coins: Vec<(String, TickerData)> = ticker_map
            .iter()
            .filter(|(_, data)| data.price > Decimal::ZERO && data.volume_quote > Decimal::ZERO) // Filter out 0 or invalid
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();

        // Sort by quote volume descending (highest volume first)
        coins.sort_by(|a, b| b.1.volume_quote.cmp(&a.1.volume_quote));

        coins.into_iter().take(limit).collect()
    }
}
