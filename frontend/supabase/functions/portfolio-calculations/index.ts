// Supabase Edge Function - Portfolio Calculations
// High-performance calculations using Deno (TypeScript)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Holding {
  coin_id: string;
  coin_symbol: string;
  quantity: number;
  average_buy_price: number;
}

interface Price {
  id: string;
  current_price: number;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    // Get user from auth header
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();

    if (!user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { prices } = await req.json();

    // Fetch user holdings
    const { data: holdings, error: holdingsError } = await supabaseClient
      .from("holdings")
      .select("*")
      .eq("user_id", user.id)
      .gt("quantity", 0);

    if (holdingsError) throw holdingsError;

    // Calculate portfolio value
    const portfolioCalculations = calculatePortfolio(holdings || [], prices);

    return new Response(
      JSON.stringify(portfolioCalculations),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// High-performance portfolio calculation function
function calculatePortfolio(holdings: Holding[], prices: Price[]) {
  const priceMap = new Map(prices.map((p) => [p.id, p.current_price]));

  let totalPortfolioValue = 0;
  let totalInvested = 0;
  const holdingsWithValue = holdings.map((holding) => {
    const currentPrice = priceMap.get(holding.coin_id) || 0;
    const currentValue = holding.quantity * currentPrice;
    const investedValue = holding.quantity * holding.average_buy_price;
    const profitLoss = currentValue - investedValue;
    const profitLossPercent =
      investedValue > 0 ? (profitLoss / investedValue) * 100 : 0;

    totalPortfolioValue += currentValue;
    totalInvested += investedValue;

    return {
      ...holding,
      current_price: currentPrice,
      current_value: currentValue,
      invested_value: investedValue,
      profit_loss: profitLoss,
      profit_loss_percent: profitLossPercent,
    };
  });

  const totalProfitLoss = totalPortfolioValue - totalInvested;
  const totalProfitLossPercent =
    totalInvested > 0 ? (totalProfitLoss / totalInvested) * 100 : 0;

  return {
    holdings: holdingsWithValue,
    summary: {
      total_portfolio_value: totalPortfolioValue,
      total_invested: totalInvested,
      total_profit_loss: totalProfitLoss,
      total_profit_loss_percent: totalProfitLossPercent,
    },
  };
}

