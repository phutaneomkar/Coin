use axum::{
    http::Method,
    routing::{get, post},
    Router,
};
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber;

mod config;
mod database;
mod handlers;
mod models;
mod services;
mod utils;

use config::Config;
use database::Database;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter("crypto_backend=debug,tower_http=debug")
        .init();

    // Load configuration
    dotenv::dotenv().ok();
    let config = Config::from_env()?;

    // Initialize database
    let db = Database::new(&config.database_url).await?;
    let pool = db.pool().clone();

    // Build application
    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/portfolio/calculate", post(handlers::portfolio::calculate_portfolio))
        .route("/api/indicators/rsi", post(handlers::indicators::calculate_rsi))
        .route("/api/indicators/sma", post(handlers::indicators::calculate_sma))
        .route("/api/indicators/ema", post(handlers::indicators::calculate_ema))
        .route("/api/indicators/macd", post(handlers::indicators::calculate_macd))
        .route("/api/orders/validate", post(handlers::orders::validate_order))
        .route("/api/orders/process", post(handlers::orders::process_order))
        .route("/api/calculations/profit-loss", post(handlers::calculations::calculate_profit_loss))
        .route("/api/calculations/portfolio-value", post(handlers::calculations::calculate_portfolio_value))
        .with_state(pool)
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
                .allow_headers(Any),
        );

    let addr = format!("0.0.0.0:{}", config.port);
    tracing::info!("🚀 Crypto Backend server running on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn health_check() -> &'static str {
    "OK"
}

