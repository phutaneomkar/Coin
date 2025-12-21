use crate::services::matching_engine::MatchingEngine;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone)]
#[allow(dead_code)]
pub struct AppState {
    pub pool: PgPool,
    pub matching_engine: Arc<MatchingEngine>,
    pub automation_engine: Arc<crate::services::automation::AutomationEngine>,
}
