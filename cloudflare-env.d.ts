declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    RECOMVIA_ADMIN_USER_ID?: string;
    AUTH_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    OPENROUTER_API_KEY?: string;
    OPENROUTER_MODEL?: string;
    OPENROUTER_MODELS_JSON?: string;
    OPENROUTER_SEARCH_TIMEOUT_MS?: string;
    MONITORING_SECRET?: string;
    AI_TEST_MODE?: string;
    PAYPAL_ENV?: string;
    PAYPAL_ENABLED?: string;
    PAYPAL_CLIENT_ID?: string;
    PAYPAL_CLIENT_SECRET?: string;
    PAYPAL_WEBHOOK_ID?: string;
    PAYPAL_PRODUCT_ID?: string;
    PAYPAL_ESSENTIAL_PLAN_ID?: string;
    PAYPAL_GROWTH_PLAN_ID?: string;
    PAYPAL_PRO_PLAN_ID?: string;
    NEXT_PUBLIC_PAYPAL_CLIENT_ID?: string;
  }
}
