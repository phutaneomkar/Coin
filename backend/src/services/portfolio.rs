use crate::models::{HoldingValue, PortfolioRequest, PortfolioResponse, PortfolioSummary};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use std::collections::HashMap;

pub fn calculate_portfolio(request: PortfolioRequest) -> PortfolioResponse {
    // Create price map for O(1) lookup
    let price_map: HashMap<String, Decimal> = request
        .prices
        .iter()
        .map(|p| (p.coin_id.clone(), p.current_price))
        .collect();

    let mut total_portfolio_value = dec!(0);
    let mut total_invested = dec!(0);
    let mut holdings_with_value = Vec::new();

    for holding in request.holdings {
        let current_price = price_map.get(&holding.coin_id).copied().unwrap_or(dec!(0));

        let current_value = holding.quantity * current_price;
        let invested_value = holding.quantity * holding.average_buy_price;
        let profit_loss = current_value - invested_value;

        let profit_loss_percent = if invested_value > dec!(0) {
            (profit_loss / invested_value) * dec!(100)
        } else {
            dec!(0)
        };

        total_portfolio_value += current_value;
        total_invested += invested_value;

        holdings_with_value.push(HoldingValue {
            coin_id: holding.coin_id,
            coin_symbol: holding.coin_symbol,
            quantity: holding.quantity,
            current_price,
            current_value,
            invested_value,
            profit_loss,
            profit_loss_percent,
        });
    }

    let total_profit_loss = total_portfolio_value - total_invested;
    let total_profit_loss_percent = if total_invested > dec!(0) {
        (total_profit_loss / total_invested) * dec!(100)
    } else {
        dec!(0)
    };

    PortfolioResponse {
        holdings: holdings_with_value,
        summary: PortfolioSummary {
            total_portfolio_value,
            total_invested,
            total_profit_loss,
            total_profit_loss_percent,
        },
    }
}
