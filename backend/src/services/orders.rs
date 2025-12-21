use crate::models::{OrderValidationRequest, OrderValidationResponse};
use rust_decimal::Decimal;
use sqlx::PgPool;

pub async fn validate_order(
    pool: &PgPool,
    request: OrderValidationRequest,
) -> anyhow::Result<OrderValidationResponse> {
    let total_amount = if let Some(price) = request.price {
        request.quantity * price
    } else {
        request.quantity * request.current_price
    };

    if request.order_type == "buy" {
        // Check balance
        let balance: Option<Decimal> =
            sqlx::query_scalar("SELECT balance_inr FROM profiles WHERE id = $1::uuid")
                .bind(&request.user_id)
                .fetch_optional(pool)
                .await?;

        if let Some(balance) = balance {
            if balance < total_amount {
                return Ok(OrderValidationResponse {
                    valid: false,
                    total_amount,
                    error: Some("Insufficient balance".to_string()),
                });
            }
        } else {
            return Ok(OrderValidationResponse {
                valid: false,
                total_amount,
                error: Some("User not found".to_string()),
            });
        }
    } else if request.order_type == "sell" {
        // Check holdings
        let holding: Option<(Decimal,)> = sqlx::query_as(
            "SELECT quantity FROM holdings WHERE user_id = $1::uuid AND coin_id = $2",
        )
        .bind(&request.user_id)
        .bind(&request.coin_id)
        .fetch_optional(pool)
        .await?;

        if let Some((quantity,)) = holding {
            if quantity < request.quantity {
                return Ok(OrderValidationResponse {
                    valid: false,
                    total_amount,
                    error: Some("Insufficient holdings".to_string()),
                });
            }
        } else {
            return Ok(OrderValidationResponse {
                valid: false,
                total_amount,
                error: Some("Insufficient holdings".to_string()),
            });
        }
    }

    Ok(OrderValidationResponse {
        valid: true,
        total_amount,
        error: None,
    })
}
