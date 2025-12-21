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
mod state;

use config::Config;
use database::Database;
use state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter("crypto_backend=debug,tower_http=debug")
        .init();

    // Load configuration
    // Clear potential stale system env vars to ensure we load from .env
    // Clear potential stale system env vars to ensure we load from .env
    // std::env::remove_var("DATABASE_URL"); // REMOVED: Breaks production deployment where env vars are passed directly
    
    if let Err(e) = dotenvy::dotenv() {
        tracing::warn!("⚠️ Failed to load .env file: {}", e);
    }
    let config = Config::from_env()?;
    tracing::info!("DEBUG: Loaded DATABASE_URL: {}", config.database_url.replace(":", "***")); 

    // Initialize database
    println!("🔌 Attempting to connect to database... URL: {}", config.database_url);
    let db = match Database::new(&config.database_url).await {
        Ok(db) => {
            println!("✅ Database connection successful!");
            db
        }
        Err(e) => {
            println!("❌ Database connection failed: {:?}", e);
            return Err(e);
        }
    };
    let pool = db.pool().clone();

    // 🚀 Start High-Performance Matching Engine
    let matching_engine = std::sync::Arc::new(services::matching_engine::MatchingEngine::new(pool.clone()));
    let me_clone = matching_engine.clone();
    tokio::spawn(async move {
        me_clone.start().await;
    });

    // Start Automation Engine
    // matching_engine is Arc<MatchingEngine>, we execute (*matching_engine).clone()
    let automation_engine = std::sync::Arc::new(crate::services::automation::AutomationEngine::new(pool.clone(), (*matching_engine).clone()));
    let ae_clone = automation_engine.clone();
    tokio::spawn(async move {
        ae_clone.start().await;
    });

    let state = AppState {
        pool,
        matching_engine,
        automation_engine,
    };

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
        .with_state(state) // Pass the entire AppState
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

