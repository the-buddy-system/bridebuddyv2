// TODO: unify client and server configs later.

export function getSupabaseConfig() {
  return {
    url: process.env.SUPABASE_URL || null,
    anonKey: process.env.SUPABASE_ANON_KEY || null,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || null
  };
}

export function getAnthropicConfig() {
  return {
    apiKey: process.env.ANTHROPIC_API_KEY || null
  };
}

export function getStripeConfig() {
  return {
    secretKey: process.env.STRIPE_SECRET_KEY || null,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || null,
    priceIds: {
      vipMonthly: process.env.STRIPE_PRICE_ID_VIP_MONTHLY || null,
      vipOneTime: process.env.STRIPE_PRICE_ID_VIP_ONETIME || null,
      vipBestieMonthly: process.env.STRIPE_PRICE_ID_VIP_BESTIE_MONTHLY || null,
      vipBestieOneTime: process.env.STRIPE_PRICE_ID_VIP_BESTIE_ONETIME || null
    }
  };
}

export function getConfig() {
  return {
    supabase: getSupabaseConfig(),
    anthropic: getAnthropicConfig(),
    stripe: getStripeConfig()
  };
}
