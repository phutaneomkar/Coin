use axum::{
    http::Method,
    routing::{get, post},
    Router,
};
use tower_http::cors::{Any, CorsLayer};

mod config;
mod database;
mod handlers;
mod models;
mod services;
mod state;
mod utils;

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

    if let Err(e) = dotenvy::dotenv() {
        tracing::warn!("⚠️ Failed to load .env file: {}", e);
    }
    let config = Config::from_env()?;
    // tracing::info!("DEBUG: Loaded DATABASE_URL: {}", config.database_url.replace(":", "***"));

    // Initialize database
    println!(
        "🔌 Attempting to connect to database... URL: {}",
        redact_database_url(&config.database_url)
    );
    let db = match Database::new(&config.database_url).await {
        Ok(db) => {
            println!("✅ Database connection successful!");
            db
        }
        Err(primary_err) => {
            if let Some(fallback_url) = &config.database_url_fallback {
                println!(
                    "⚠️ Primary database connection failed, trying fallback... URL: {}",
                    redact_database_url(fallback_url)
                );

                match Database::new(fallback_url).await {
                    Ok(db) => {
                        println!("✅ Database connection successful (fallback)!");
                        db
                    }
                    Err(fallback_err) => {
                        println!("❌ Database connection failed (primary): {:?}", primary_err);
                        println!(
                            "❌ Database connection failed (fallback): {:?}",
                            fallback_err
                        );
                        return Err(fallback_err);
                    }
                }
            } else {
                println!("❌ Database connection failed: {:?}", primary_err);
                return Err(primary_err);
            }
        }
    };
    let pool = db.pool().clone();

    // 🚀 Start High-Performance Matching Engine
    let matching_engine =
        std::sync::Arc::new(services::matching_engine::MatchingEngine::new(pool.clone()));
    let me_clone = matching_engine.clone();
    tokio::spawn(async move {
        me_clone.start().await;
    });

    // Start Automation Engine
    // matching_engine is Arc<MatchingEngine>, we execute (*matching_engine).clone()
    let automation_engine =
        std::sync::Arc::new(crate::services::automation::AutomationEngine::new(
            pool.clone(),
            (*matching_engine).clone(),
        ));
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
        .route(
            "/api/portfolio/calculate",
            post(handlers::portfolio::calculate_portfolio),
        )
        .route(
            "/api/indicators/rsi",
            post(handlers::indicators::calculate_rsi),
        )
        .route(
            "/api/indicators/sma",
            post(handlers::indicators::calculate_sma),
        )
        .route(
            "/api/indicators/ema",
            post(handlers::indicators::calculate_ema),
        )
        .route(
            "/api/indicators/macd",
            post(handlers::indicators::calculate_macd),
        )
        .route(
            "/api/orders/validate",
            post(handlers::orders::validate_order),
        )
        .route("/api/orders/process", post(handlers::orders::process_order))
        .route(
            "/api/calculations/profit-loss",
            post(handlers::calculations::calculate_profit_loss),
        )
        .route(
            "/api/calculations/portfolio-value",
            post(handlers::calculations::calculate_portfolio_value),
        )
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

fn redact_database_url(database_url: &str) -> String {
    match url::Url::parse(database_url) {
        Ok(mut parsed) => {
            let _ = parsed.set_password(Some("********"));
            parsed.to_string()
        }
        Err(_) => "<invalid DATABASE_URL>".to_string(),
    }
}

async fn health_check() -> &'static str {
    "OK"
}
