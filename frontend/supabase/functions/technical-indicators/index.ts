// Supabase Edge Function - Technical Indicators
// Fast calculations for RSI, MACD, Moving Averages, etc.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { prices, indicator, period } = await req.json();

    let result;
    switch (indicator) {
      case "rsi":
        result = calculateRSI(prices, period || 14);
        break;
      case "sma":
        result = calculateSMA(prices, period || 20);
        break;
      case "ema":
        result = calculateEMA(prices, period || 20);
        break;
      case "macd":
        result = calculateMACD(prices);
        break;
      default:
        throw new Error(`Unknown indicator: ${indicator}`);
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Relative Strength Index (RSI)
function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) {
    throw new Error(`Need at least ${period + 1} price points for RSI`);
  }

  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  let gains = 0;
  let losses = 0;

  // Initial average
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) gains += changes[i];
    else losses += Math.abs(changes[i]);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Smoothed averages
  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// Simple Moving Average
function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) {
    throw new Error(`Need at least ${period} price points for SMA`);
  }
  const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
  return sum / period;
}

// Exponential Moving Average
function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) {
    throw new Error(`Need at least ${period} price points for EMA`);
  }

  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }

  return ema;
}

// MACD (Moving Average Convergence Divergence)
function calculateMACD(prices: number[]): {
  macd: number;
  signal: number;
  histogram: number;
} {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12 - ema26;

  // Signal line (9-period EMA of MACD)
  // Simplified: using last 9 MACD values
  const signal = calculateEMA([macd], 9);
  const histogram = macd - signal;

  return { macd, signal, histogram };
}

