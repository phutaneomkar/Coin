use axum::Json;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use crate::models::{IndicatorRequest, IndicatorResponse};

pub async fn calculate_rsi(
    Json(request): Json<IndicatorRequest>,
) -> Json<IndicatorResponse> {
    // Simple RSI calculation (simplified version)
    let period = request.period.unwrap_or(14);
    let prices = &request.prices;
    
    if prices.len() < period as usize + 1 {
        return Json(IndicatorResponse {
            value: dec!(50), // Neutral RSI
            values: None,
        });
    }

    // Calculate average gain and loss
    let mut gains = Decimal::ZERO;
    let mut losses = Decimal::ZERO;

    for i in 1..=period as usize {
        let change = prices[i] - prices[i - 1];
        if change > dec!(0) {
            gains += change;
        } else {
            losses += change.abs();
        }
    }

    let avg_gain = gains / Decimal::from(period);
    let avg_loss = losses / Decimal::from(period);

    let rs = if avg_loss > dec!(0) {
        avg_gain / avg_loss
    } else {
        dec!(100)
    };

    let rsi = dec!(100) - (dec!(100) / (dec!(1) + rs));

    Json(IndicatorResponse {
        value: rsi,
        values: None,
    })
}

pub async fn calculate_sma(
    Json(request): Json<IndicatorRequest>,
) -> Json<IndicatorResponse> {
    let period = request.period.unwrap_or(20);
    let prices = &request.prices;

    if prices.is_empty() {
        return Json(IndicatorResponse {
            value: Decimal::ZERO,
            values: None,
        });
    }

    let start = if prices.len() > period as usize {
        prices.len() - period as usize
    } else {
        0
    };

    let sum: Decimal = prices[start..].iter().sum();
    let count = prices[start..].len() as u32;
    let sma = if count > 0 {
        sum / Decimal::from(count)
    } else {
        Decimal::ZERO
    };

    Json(IndicatorResponse {
        value: sma,
        values: None,
    })
}

pub async fn calculate_ema(
    Json(request): Json<IndicatorRequest>,
) -> Json<IndicatorResponse> {
    let period = request.period.unwrap_or(20);
    let prices = &request.prices;

    if prices.is_empty() {
        return Json(IndicatorResponse {
            value: Decimal::ZERO,
            values: None,
        });
    }

    let multiplier = dec!(2) / (Decimal::from(period) + dec!(1));
    let mut ema = prices[0];

    for price in prices.iter().skip(1) {
        ema = (price * multiplier) + (ema * (dec!(1) - multiplier));
    }

    Json(IndicatorResponse {
        value: ema,
        values: None,
    })
}

pub async fn calculate_macd(
    Json(request): Json<IndicatorRequest>,
) -> Json<IndicatorResponse> {
    // MACD = EMA(12) - EMA(26)
    // For simplicity, we'll use the last price as MACD value
    let prices = &request.prices;

    if prices.len() < 26 {
        return Json(IndicatorResponse {
            value: Decimal::ZERO,
            values: None,
        });
    }

    // Calculate EMA(12) and EMA(26)
    let ema12 = calculate_ema_helper(prices, 12);
    let ema26 = calculate_ema_helper(prices, 26);
    let macd = ema12 - ema26;

    Json(IndicatorResponse {
        value: macd,
        values: None,
    })
}

fn calculate_ema_helper(prices: &[Decimal], period: u32) -> Decimal {
    if prices.is_empty() {
        return Decimal::ZERO;
    }

    let multiplier = dec!(2) / (Decimal::from(period) + dec!(1));
    let mut ema = prices[0];

    for price in prices.iter().skip(1) {
        ema = (price * multiplier) + (ema * (dec!(1) - multiplier));
    }

    ema
}
