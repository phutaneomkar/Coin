// Utility functions for the crypto backend

use rust_decimal::Decimal;

/// Round a decimal to a specific number of decimal places
#[allow(dead_code)]
pub fn round_decimal(value: Decimal, decimals: u32) -> Decimal {
    let multiplier = Decimal::from(10_i64.pow(decimals));
    (value * multiplier).round() / multiplier
}

/// Format a decimal as a currency string
#[allow(dead_code)]
pub fn format_currency(value: Decimal) -> String {
    format!("${:.2}", value)
}
