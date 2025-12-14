use axum::Json;
use crate::models::{PortfolioRequest, PortfolioResponse};
use crate::services::portfolio;

pub async fn calculate_portfolio(
    Json(request): Json<PortfolioRequest>,
) -> Json<PortfolioResponse> {
    Json(portfolio::calculate_portfolio(request))
}
