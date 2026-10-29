import { getPayPalBaseUrl, getPayPalConfig } from "./config";
import type { PayPalConfig, PayPalTransport } from "./types";

export class PayPalError extends Error {
  readonly status: number;
  readonly debugId?: string;
  readonly paypalName?: string;

  constructor(message: string, status = 500, debugId?: string, paypalName?: string) {
    super(message);
    this.name = "PayPalError";
    this.status = status;
    this.debugId = debugId;
    this.paypalName = paypalName;
  }
}

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

let cachedToken: CachedToken | null = null;
let customTransport: PayPalTransport | null = null;

export function setPayPalTransport(transport: PayPalTransport | null): void {
  customTransport = transport;
}

export function clearPayPalTokenCache(): void {
  cachedToken = null;
}

export function setCachedPayPalToken(token: string, expiresInSeconds: number): void {
  cachedToken = {
    accessToken: token,
    expiresAt: Date.now() + Math.max(0, (expiresInSeconds - 60) * 1000),
  };
}

const DEFAULT_TIMEOUT_MS = 10_000;

function createTimeoutSignal(timeoutMs = DEFAULT_TIMEOUT_MS): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

/**
 * Encodes basic auth credentials without exposing them in logs.
 */
function basicAuthHeader(clientId: string, clientSecret: string): string {
  if (typeof Buffer !== "undefined") {
    return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  }
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

/**
 * Obtains an OAuth2 client credentials token from PayPal.
 * Never logs the client secret or returned access token.
 */
export async function getPayPalAccessToken(
  configInput?: Partial<PayPalConfig>,
  transport?: PayPalTransport,
): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.accessToken;
  }

  const config = getPayPalConfig(configInput);
  if (!config.PAYPAL_CLIENT_ID || !config.PAYPAL_CLIENT_SECRET) {
    throw new PayPalError(
      "PayPal credentials are not configured. Please supply PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.",
      500,
    );
  }

  const baseUrl = getPayPalBaseUrl(config.PAYPAL_ENV);
  const tokenUrl = `${baseUrl}/v1/oauth2/token`;
  const fetcher = transport || customTransport || fetch;

  const response = await fetcher(tokenUrl, {
    method: "POST",
    headers: {
      "Authorization": basicAuthHeader(config.PAYPAL_CLIENT_ID, config.PAYPAL_CLIENT_SECRET),
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: "grant_type=client_credentials",
    signal: createTimeoutSignal(),
  });

  if (!response.ok) {
    let debugId: string | undefined;
    let errorName: string | undefined;
    let message = "Failed to obtain PayPal OAuth token.";
    try {
      const errJson = (await response.json()) as {
        debug_id?: string;
        error?: string;
        error_description?: string;
      };
      debugId = errJson.debug_id;
      errorName = errJson.error;
      message = errJson.error_description || message;
    } catch {
      // response wasn't JSON
    }
    throw new PayPalError(message, response.status, debugId, errorName);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  if (!data.access_token) {
    throw new PayPalError("PayPal response omitted access_token.", 500);
  }

  setCachedPayPalToken(data.access_token, data.expires_in || 3600);
  return data.access_token;
}

/**
 * Authenticated PayPal API request wrapper with bounded timeout and normalized error reporting.
 */
export async function paypalRequest<T>(
  endpoint: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    headers?: Record<string, string>;
    config?: Partial<PayPalConfig>;
    transport?: PayPalTransport;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const config = getPayPalConfig(options.config);
  const baseUrl = getPayPalBaseUrl(config.PAYPAL_ENV);
  const url = endpoint.startsWith("http") ? endpoint : `${baseUrl}${endpoint}`;
  const accessToken = await getPayPalAccessToken(config, options.transport || customTransport || undefined);
  const fetcher = options.transport || customTransport || fetch;

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
    ...options.headers,
  };

  const response = await fetcher(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: createTimeoutSignal(options.timeoutMs || DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    let debugId: string | undefined;
    let paypalName: string | undefined;
    let message = `PayPal API request failed (${response.status} ${response.statusText})`;
    try {
      const errorData = (await response.json()) as {
        debug_id?: string;
        name?: string;
        error?: string;
        message?: string;
        error_description?: string;
      };
      debugId = errorData.debug_id;
      paypalName = errorData.name || errorData.error;
      message = errorData.message || errorData.error_description || message;
    } catch {
      // ignore
    }
    throw new PayPalError(message, response.status, debugId, paypalName);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
}
