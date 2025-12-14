use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct OrderValidationRequest {
    pub user_id: String,
    pub coin_id: String,
    pub coin_symbol: String,
    pub order_type: String,
    pub quantity: Decimal,
    pub price: Option<Decimal>,
    pub current_price: Decimal,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct OrderValidationResponse {
    pub valid: bool,
    pub total_amount: Decimal,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PortfolioRequest {
    pub holdings: Vec<Holding>,
    pub prices: Vec<Price>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Holding {
    pub coin_id: String,
    pub coin_symbol: String,
    pub quantity: Decimal,
    pub average_buy_price: Decimal,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Price {
    pub coin_id: String,
    pub current_price: Decimal,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PortfolioResponse {
    pub holdings: Vec<HoldingValue>,
    pub summary: PortfolioSummary,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct HoldingValue {
    pub coin_id: String,
    pub coin_symbol: String,
    pub quantity: Decimal,
    pub current_price: Decimal,
    pub current_value: Decimal,
    pub invested_value: Decimal,
    pub profit_loss: Decimal,
    pub profit_loss_percent: Decimal,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PortfolioSummary {
    pub total_portfolio_value: Decimal,
    pub total_invested: Decimal,
    pub total_profit_loss: Decimal,
    pub total_profit_loss_percent: Decimal,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct IndicatorRequest {
    pub coin_id: String,
    pub prices: Vec<Decimal>,
    pub period: Option<u32>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct IndicatorResponse {
    pub value: Decimal,
    pub values: Option<Vec<Decimal>>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ProfitLossRequest {
    pub holdings: Vec<Holding>,
    pub prices: Vec<Price>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ProfitLossResponse {
    pub total_profit_loss: Decimal,
    pub total_profit_loss_percent: Decimal,
    pub holdings: Vec<HoldingValue>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PortfolioValueRequest {
    pub holdings: Vec<Holding>,
    pub prices: Vec<Price>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PortfolioValueResponse {
    pub total_value: Decimal,
}
