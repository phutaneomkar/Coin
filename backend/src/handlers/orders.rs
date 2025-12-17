use axum::{extract::State, Json};
use crate::models::{OrderValidationRequest, OrderValidationResponse};
use crate::services::orders;

use crate::state::AppState; // Import AppState

pub async fn validate_order(
    State(state): State<AppState>,
    Json(request): Json<OrderValidationRequest>,
) -> Result<Json<OrderValidationResponse>, axum::http::StatusCode> {
    match orders::validate_order(&state.pool, request).await {
        Ok(response) => Ok(Json(response)),
        Err(e) => {
            tracing::error!("Error validating order: {}", e);
            Err(axum::http::StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn process_order(
    State(state): State<AppState>,
    Json(request): Json<OrderValidationRequest>,
) -> Result<Json<OrderValidationResponse>, axum::http::StatusCode> {
    
    // 1. Add order to Memory Engine if it has an ID and is a Limit Order
    if let Some(order_id) = &request.id {
        if let Some(price) = request.price {
            // It's a limit order
            state.matching_engine.add_order(
                order_id.clone(),
                request.coin_id.clone(),
                request.order_type.clone(),
                price,
                request.quantity,
            ).await;
            tracing::info!("🚀 Added Order {} to Matching Engine", order_id);
        }
    } else {
        tracing::warn!("⚠️ Process Order called without Order ID or Price");
    }
    
    validate_order(State(state), Json(request)).await
}
