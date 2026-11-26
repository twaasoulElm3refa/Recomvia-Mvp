import { env } from "cloudflare:workers";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from "@/app/chatgpt-auth";

export type AuthUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

type SessionPayload = {
  v: 1;
  sub: string;
  email: string;
  name: string | null;
  iat: number;
  exp: number;
};

export const SESSION_COOKIE = "__Host-recomvia_session";
export const OAUTH_STATE_COOKIE = "__Host-recomvia_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "__Host-recomvia_oauth_verifier";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;
// A browser cookie cannot exceed 4 KiB; reject larger or malformed values before HMAC work.
const MAX_SESSION_COOKIE_LENGTH = 4096;

// The hosted ChatGPT Site and standalone Cloudflare deployment use different
// trusted identity providers. Never infer this setting from user-supplied headers.
export function authProvider(): "chatgpt" | "google" {
  return env.AUTH_PROVIDER === "chatgpt" ? "chatgpt" : "google";
}

export function signInPath(returnTo = "/dashboard") {
  return authProvider() === "chatgpt" ? chatGPTSignInPath(returnTo) : "/auth/google";
}

export function signOutPath(returnTo = "/") {
  return authProvider() === "chatgpt" ? chatGPTSignOutPath(returnTo) : "/auth/signout";
}

export function getAppOrigin(request: Request) {
  return new URL(request.url).origin;
}

export function getGoogleCallbackUrl(request: Request) {
  return `${getAppOrigin(request)}/auth/google/callback`;
}

export async function getAuthenticatedUser(): Promise<AuthUser | null> {
  if (authProvider() === "chatgpt") return getChatGPTUser();
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return null;
  const payload = await verifySession(value);
  if (!payload) return null;
  return {
    userId: `google:${payload.sub}`,
    displayName: payload.name?.trim() || payload.email,
    email: payload.email,
    fullName: payload.name,
  };
}

export async function requireAuthenticatedUser(): Promise<AuthUser> {
  const user = await getAuthenticatedUser();
  if (user) return user;
  redirect(signInPath());
}

export function getGoogleCredentials() {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const authSecret = env.AUTH_SECRET?.trim();
  if (!clientId || !clientSecret || !authSecret) throw new Error("Authentication is not configured.");
  return { clientId, clientSecret };
}

export async function createSession(input: { sub: string; email: string; name: string | null }) {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { v: 1, ...input, iat: now, exp: now + SESSION_MAX_AGE };
  const encodedPayload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${encodedPayload}.${await sign(encodedPayload)}`;
}

export async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return encodeBase64Url(new Uint8Array(digest));
}

export function randomBase64Url(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export function constantTimeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

async function verifySession(value: string): Promise<SessionPayload | null> {
  if (value.length > MAX_SESSION_COOKIE_LENGTH) return null;
  const [encodedPayload, signature, extra] = value.split(".");
  if (!encodedPayload || !/^[A-Za-z0-9_-]+$/.test(encodedPayload) ||
      !signature || !/^[A-Za-z0-9_-]{43}$/.test(signature) || extra !== undefined) return null;
  // A stale browser cookie must not turn an unconfigured deployment into a 500.
  // Only session verification fails closed; creating new sessions still requires a secret.
  if (!env.AUTH_SECRET?.trim()) return null;
  if (!constantTimeEqual(signature, await sign(encodedPayload))) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload))) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (!payload || payload.v !== 1 ||
        typeof payload.sub !== "string" || !payload.sub ||
        typeof payload.email !== "string" || !payload.email ||
        (payload.name !== null && typeof payload.name !== "string") ||
        !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
        payload.iat > now + 60 || payload.exp <= now ||
        payload.exp <= payload.iat || payload.exp - payload.iat > SESSION_MAX_AGE) return null;
    return payload;
  } catch {
    return null;
  }
}

async function sign(value: string) {
  const secret = env.AUTH_SECRET?.trim();
  if (!secret) throw new Error("Authentication is not configured.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return encodeBase64Url(new Uint8Array(signature));
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
