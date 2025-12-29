use axum::{
    extract::State,
    http::Method,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
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
    // Retry database connection loop
    let mut retry_count = 0;
    const MAX_RETRIES: u32 = 20; // Try for ~100 seconds (20 * 5s)
    
    let db = loop {
        println!(
            "🔌 Attempting to connect to database... URL: {} (Attempt {}/{})",
            redact_database_url(&config.database_url),
            retry_count + 1,
            MAX_RETRIES
        );
        
        // Debug: Parse and print host to check for typos
        if let Ok(parsed) = url::Url::parse(&config.database_url) {
            println!("🔍 Resolving host: {:?}", parsed.host_str());
        }

        match Database::new(&config.database_url).await {
            Ok(db) => {
                println!("✅ Database connection successful!");
                break db;
            }
            Err(primary_err) => {
                println!("⚠️ Primary connection failed: {:?}", primary_err);
                
                // Try fallback if available
                if let Some(fallback_url) = &config.database_url_fallback {
                    println!(
                        "🔄 Trying fallback... URL: {}",
                        redact_database_url(fallback_url)
                    );
                    match Database::new(fallback_url).await {
                        Ok(db) => {
                            println!("✅ Database connection successful (fallback)!");
                            break db;
                        }
                        Err(fallback_err) => {
                            println!("❌ Fallback failed: {:?}", fallback_err);
                        }
                    }
                }

                retry_count += 1;
                if retry_count >= MAX_RETRIES {
                    println!("❌ All connection attempts failed. Exiting.");
                    return Err(primary_err);
                }
                
                println!("⏳ Retrying in 5 seconds...");
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
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
        .route("/", get(health_check)) // Root route also returns OK
        .route("/health", get(health_check))
        .route("/health/db", get(health_check_db)) // Database health check
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
        .route("/api/orders/recent", get(handlers::orders::get_recent_orders))
        .route(
            "/api/calculations/profit-loss",
            post(handlers::calculations::calculate_profit_loss),
        )
        .route(
            "/api/calculations/portfolio-value",
            post(handlers::calculations::calculate_portfolio_value),
        )
        // Automation Routes
        .route(
            "/api/automation/start",
            post(handlers::automation::start_strategy),
        )
        .route(
            "/api/automation/:id/stop",
            post(handlers::automation::stop_strategy),
        )
        .route(
            "/api/automation/:id/panic",
            post(handlers::automation::panic_strategy),
        )
        .route(
            "/api/automation/strategies",
            get(handlers::automation::get_strategies),
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

async fn health_check_db(State(state): State<AppState>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    use serde_json::json;
    
    // Test database connection with a simple query
    match sqlx::query("SELECT 1 as test")
        .fetch_one(&state.pool)
        .await
    {
        Ok(_) => {
            // Test strategies table exists and is accessible
            match sqlx::query("SELECT COUNT(*) as count FROM strategies")
                .fetch_one(&state.pool)
                .await
            {
                Ok(row) => {
                    let count: i64 = row.get("count");
                    Ok(Json(json!({
                        "status": "healthy",
                        "database": "connected",
                        "strategies_table": "accessible",
                        "strategies_count": count,
                        "timestamp": chrono::Utc::now().to_rfc3339()
                    })))
                }
                Err(e) => {
                    Ok(Json(json!({
                        "status": "degraded",
                        "database": "connected",
                        "strategies_table": "error",
                        "error": format!("{}", e),
                        "timestamp": chrono::Utc::now().to_rfc3339()
                    })))
                }
            }
        }
        Err(e) => {
            Err((
                StatusCode::SERVICE_UNAVAILABLE,
                format!("Database connection failed: {}", e)
            ))
        }
    }
}
