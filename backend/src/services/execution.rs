use rust_decimal::Decimal;
use sqlx::{PgPool, Row};
use tracing::{error, info};
use uuid::Uuid;

const TRADING_FEE_RATE_NUM: i64 = 1;
const TRADING_FEE_RATE_SCALE: u32 = 3; 
// 0.001

pub async fn execute_order(pool: &PgPool, order_id: Uuid, execution_price: Decimal) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;

    // 1. Fetch Order (Runtime Query)
    let row = sqlx::query(
        r#"SELECT id, user_id, coin_id, coin_symbol, order_type, quantity, total_amount, price_per_unit 
           FROM orders WHERE id = $1"#
    )
    .bind(order_id)
    .fetch_optional(&mut *tx)
    .await?;

    let order_row = match row {
        Some(r) => r,
        None => {
            error!("Order {} not found during execution", order_id);
            return Ok(());
        }
    };

    let user_id: Uuid = order_row.try_get("user_id")?;
    let coin_id_raw: String = order_row.try_get("coin_id")?;
    let coin_symbol: String = order_row.try_get("coin_symbol")?;
    let order_type: String = order_row.try_get("order_type")?;
    let quantity: Decimal = order_row.try_get("quantity")?;
    
    // Recalculate total amount
    let total_amount = execution_price * quantity;
    
    // Fee Calculation
    let fee_rate = Decimal::new(TRADING_FEE_RATE_NUM, TRADING_FEE_RATE_SCALE);
    let trading_fee = total_amount * fee_rate; 

    // Ensure Profile Exists
    let profile_row = sqlx::query(
        "SELECT id, balance_inr FROM profiles WHERE id = $1 FOR UPDATE"
    )
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;

    let mut balance: Decimal = if let Some(p) = profile_row {
        p.try_get("balance_inr")?
    } else {
        info!("Creating profile for user {}", user_id);
        let initial_balance = Decimal::from(100000); 
        sqlx::query(
            "INSERT INTO profiles (id, email, full_name, balance_inr) VALUES ($1, $2, $3, $4)"
        )
        .bind(user_id)
        .bind("guest@automation.com")
        .bind("Automation Guest")
        .bind(initial_balance)
        .execute(&mut *tx)
        .await?;
        initial_balance
    };

    let coin_id = coin_id_raw.trim().to_lowercase();

    if order_type == "buy" {
        let total_cost = total_amount + trading_fee;
        
        if balance < total_cost {
            error!("Insufficient balance for user {}. Required: {}, Available: {}", user_id, total_cost, balance);
            return Err(anyhow::anyhow!("Insufficient balance"));
        }

        balance -= total_cost;

        // Update Balance
        sqlx::query("UPDATE profiles SET balance_inr = $1 WHERE id = $2")
            .bind(balance)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;

        // Check Holding
        let holding_row = sqlx::query(
            "SELECT id, quantity, average_buy_price FROM holdings WHERE user_id = $1 AND lower(coin_id) = $2"
        )
        .bind(user_id)
        .bind(&coin_id)
        .fetch_optional(&mut *tx)
        .await?;

        if let Some(h) = holding_row {
            let holding_id: Uuid = h.try_get("id")?;
            let current_qty: Decimal = h.try_get("quantity")?;
            let current_avg: Decimal = h.try_get("average_buy_price")?;
            
            let total_qty = current_qty + quantity;
            let old_cost = current_qty * current_avg;
            let new_cost = total_amount; 
            let new_avg = (old_cost + new_cost) / total_qty;

            sqlx::query(
                "UPDATE holdings SET quantity = $1, average_buy_price = $2, last_updated = NOW() WHERE id = $3"
            )
            .bind(total_qty)
            .bind(new_avg)
            .bind(holding_id)
            .execute(&mut *tx)
            .await?;
        } else {
            sqlx::query(
                "INSERT INTO holdings (user_id, coin_id, coin_symbol, quantity, average_buy_price, last_updated) VALUES ($1, $2, $3, $4, $5, NOW())"
            )
            .bind(user_id)
            .bind(&coin_id)
            .bind(&coin_symbol)
            .bind(quantity)
            .bind(execution_price)
            .execute(&mut *tx)
            .await?;
        }

        info!("💸 BUY Executed: Deducted {} from balance. New Balance: {}", total_cost, balance);

    } else if order_type == "sell" {
         let holding_row = sqlx::query(
            "SELECT id, quantity, average_buy_price FROM holdings WHERE user_id = $1 AND lower(coin_id) = $2"
        )
        .bind(user_id)
        .bind(&coin_id)
        .fetch_optional(&mut *tx)
        .await?;

        let current_qty: Decimal = if let Some(ref h) = holding_row {
            h.try_get("quantity")?
        } else {
            Decimal::ZERO
        };
        
        if current_qty < quantity {
             error!("Insufficient holdings for user {}. Selling: {}, Held: {}", user_id, quantity, current_qty);
        }

        let new_qty = current_qty - quantity;
        if let Some(h) = holding_row {
            let holding_id: Uuid = h.try_get("id")?;
            
            // Use strict comparison or epsilon
            let epsilon = Decimal::new(1, 6);
            if new_qty > epsilon { 
                sqlx::query(
                    "UPDATE holdings SET quantity = $1, last_updated = NOW() WHERE id = $2"
                )
                .bind(new_qty)
                .bind(holding_id)
                .execute(&mut *tx)
                .await?;
            } else {
                sqlx::query("DELETE FROM holdings WHERE id = $1")
                .bind(holding_id)
                .execute(&mut *tx)
                .await?;
            }
        }

        let proceeds = total_amount - trading_fee;
        balance += proceeds;

        sqlx::query("UPDATE profiles SET balance_inr = $1 WHERE id = $2")
            .bind(balance)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;

        info!("💰 SELL Executed: Added {} to balance. New Balance: {}", proceeds, balance);
    }

    sqlx::query(
        "INSERT INTO transactions (user_id, order_id, transaction_type, coin_id, coin_symbol, quantity, price_per_unit, total_amount, transaction_date) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())"
    )
    .bind(user_id)
    .bind(order_id)
    .bind(order_type)
    .bind(coin_id)
    .bind(coin_symbol)
    .bind(quantity)
    .bind(execution_price)
    .bind(total_amount)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(())
}
