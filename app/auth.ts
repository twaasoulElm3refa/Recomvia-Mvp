import { env } from "cloudflare:workers";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

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

export const APP_ORIGIN = "https://recomvia.recomvia.workers.dev";
export const GOOGLE_CALLBACK_URL = `${APP_ORIGIN}/auth/google/callback`;
export const SESSION_COOKIE = "__Host-recomvia_session";
export const OAUTH_STATE_COOKIE = "__Host-recomvia_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "__Host-recomvia_oauth_verifier";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

export async function getAuthenticatedUser(): Promise<AuthUser | null> {
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
  redirect("/auth/google");
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
  const [encodedPayload, signature, extra] = value.split(".");
  if (!encodedPayload || !signature || extra) return null;
  if (!constantTimeEqual(signature, await sign(encodedPayload))) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload))) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.v !== 1 || !payload.sub || !payload.email || payload.iat > now + 60 || payload.exp <= now) return null;
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
