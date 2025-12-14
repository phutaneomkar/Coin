use axum::Json;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use std::collections::HashMap;
use crate::models::{ProfitLossRequest, ProfitLossResponse, PortfolioValueRequest, PortfolioValueResponse, HoldingValue};

pub async fn calculate_profit_loss(
    Json(request): Json<ProfitLossRequest>,
) -> Json<ProfitLossResponse> {
    let price_map: HashMap<String, Decimal> = request
        .prices
        .iter()
        .map(|p| (p.coin_id.clone(), p.current_price))
        .collect();

    let mut total_profit_loss = dec!(0);
    let mut total_invested = dec!(0);
    let mut holdings_with_value = Vec::new();

    for holding in request.holdings {
        let current_price = price_map
            .get(&holding.coin_id)
            .copied()
            .unwrap_or(dec!(0));

        let current_value = holding.quantity * current_price;
        let invested_value = holding.quantity * holding.average_buy_price;
        let profit_loss = current_value - invested_value;

        total_profit_loss += profit_loss;
        total_invested += invested_value;

        holdings_with_value.push(HoldingValue {
            coin_id: holding.coin_id,
            coin_symbol: holding.coin_symbol,
            quantity: holding.quantity,
            current_price,
            current_value,
            invested_value,
            profit_loss,
            profit_loss_percent: if invested_value > dec!(0) {
                (profit_loss / invested_value) * dec!(100)
            } else {
                dec!(0)
            },
        });
    }

    let total_profit_loss_percent = if total_invested > dec!(0) {
        (total_profit_loss / total_invested) * dec!(100)
    } else {
        dec!(0)
    };

    Json(ProfitLossResponse {
        total_profit_loss,
        total_profit_loss_percent,
        holdings: holdings_with_value,
    })
}

pub async fn calculate_portfolio_value(
    Json(request): Json<PortfolioValueRequest>,
) -> Json<PortfolioValueResponse> {
    let price_map: HashMap<String, Decimal> = request
        .prices
        .iter()
        .map(|p| (p.coin_id.clone(), p.current_price))
        .collect();

    let mut total_value = dec!(0);

    for holding in request.holdings {
        let current_price = price_map
            .get(&holding.coin_id)
            .copied()
            .unwrap_or(dec!(0));
        total_value += holding.quantity * current_price;
    }

    Json(PortfolioValueResponse {
        total_value,
    })
}
