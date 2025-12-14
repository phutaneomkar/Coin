use axum::{extract::State, Json};
use crate::models::{OrderValidationRequest, OrderValidationResponse};
use crate::services::orders;

pub async fn validate_order(
    State(pool): State<sqlx::Pool<sqlx::Postgres>>,
    Json(request): Json<OrderValidationRequest>,
) -> Result<Json<OrderValidationResponse>, axum::http::StatusCode> {
    match orders::validate_order(&pool, request).await {
        Ok(response) => Ok(Json(response)),
        Err(e) => {
            tracing::error!("Error validating order: {}", e);
            Err(axum::http::StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn process_order(
    State(pool): State<sqlx::Pool<sqlx::Postgres>>,
    Json(request): Json<OrderValidationRequest>,
) -> Result<Json<OrderValidationResponse>, axum::http::StatusCode> {
    // For now, just validate the order
    // In production, this would also execute the order
    validate_order(State(pool), Json(request)).await
}
