use crate::state::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct CreateStrategyRequest {
    pub user_id: String, // Ideally from Auth context, keeping explicit for now
    pub amount: Decimal,
    pub profit_percentage: Decimal,
    pub total_iterations: i32,
    pub duration_minutes: i32,
}

#[derive(Debug, Serialize)]
pub struct StrategyResponse {
    pub id: String, // UUID as String
    pub status: String,
    pub message: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct StrategyDto {
    pub id: Uuid,
    pub amount: Decimal,
    pub profit_percentage: Decimal,
    pub total_iterations: i32,
    pub iterations_completed: i32,
    pub duration_minutes: i32,
    pub status: String,
    pub current_coin_id: Option<String>,
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub async fn start_strategy(
    State(state): State<AppState>,
    Json(payload): Json<CreateStrategyRequest>,
) -> Result<Json<StrategyResponse>, (StatusCode, String)> {
    println!("DEBUG: Received start_strategy request. Payload: {:?}", payload);

    // Basic Validation
    if payload.amount <= Decimal::ZERO {
        println!("DEBUG: Invalid amount: {}", payload.amount);
        return Err((
            StatusCode::BAD_REQUEST,
            "Amount must be greater than 0".to_string(),
        ));
    }

    let user_uuid = Uuid::parse_str(&payload.user_id)
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid User ID".to_string()))?;

    let strategy_id = Uuid::new_v4();

    // Insert Strategy
    sqlx::query(
        "INSERT INTO strategies (id, user_id, amount, profit_percentage, total_iterations, duration_minutes, status) VALUES ($1, $2, $3, $4, $5, $6, 'running')"
    )
    .bind(strategy_id)
    .bind(user_uuid)
    .bind(payload.amount)
    .bind(payload.profit_percentage)
    .bind(payload.total_iterations)
    .bind(payload.duration_minutes)
    .execute(&state.pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)))?;

    Ok(Json(StrategyResponse {
        id: strategy_id.to_string(),
        status: "running".to_string(),
        message: "Automation strategy started successfully".to_string(),
    }))
}

pub async fn stop_strategy(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<StrategyResponse>, (StatusCode, String)> {
    let strategy_uuid = Uuid::parse_str(&id)
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid Strategy ID".to_string()))?;

    // Update Status
    let result = sqlx::query("UPDATE strategies SET status = 'stopped' WHERE id = $1")
        .bind(strategy_uuid)
        .execute(&state.pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)))?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "Strategy not found".to_string()));
    }

    Ok(Json(StrategyResponse {
        id: id,
        status: "stopped".to_string(),
        message: "Strategy stopped".to_string(),
    }))
}

pub async fn panic_strategy(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<StrategyResponse>, (StatusCode, String)> {
    let strategy_uuid = Uuid::parse_str(&id)
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid Strategy ID".to_string()))?;

    state.automation_engine.force_exit_strategy(strategy_uuid).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Force exit failed: {}", e)))?;

    Ok(Json(StrategyResponse {
        id: id,
        status: "stopped".to_string(),
        message: "Strategy force stopped and positions liquidated".to_string(),
    }))
}

pub async fn get_strategies(
    State(state): State<AppState>,
) -> Result<Json<Vec<StrategyDto>>, (StatusCode, String)> {
    // Ideally filter by user_id from auth context, fetching all for now or passing user_id as query param?
    // For simplicity, let's just fetch all running/recent strategies. 
    // In production, we MUST filter by user. Assuming single user/demo for now based on context.
    
    let strategies = sqlx::query_as::<_, StrategyDto>(
        "SELECT id, amount, profit_percentage, total_iterations, iterations_completed, duration_minutes, status, current_coin_id, created_at FROM strategies ORDER BY created_at DESC LIMIT 20"
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)))?;

    Ok(Json(strategies))
}
