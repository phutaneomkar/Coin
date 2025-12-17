use sqlx::PgPool;
use std::sync::Arc;
use crate::services::matching_engine::MatchingEngine;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub matching_engine: Arc<MatchingEngine>,
}
