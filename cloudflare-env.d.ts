declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    RECOMVIA_ADMIN_USER_ID?: string;
    AUTH_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    OPENAI_API_KEY?: string;
    OPENAI_VISIBILITY_MODEL?: string;
  }
}
