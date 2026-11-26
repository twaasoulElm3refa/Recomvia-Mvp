import { headers } from "next/headers";

export type ChatGPTUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

// These headers are only trusted when AUTH_PROVIDER=chatgpt is deliberately
// configured for the Sites host, which authenticates and injects identity.
export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  if (!userId || !email) return null;

  const name = requestHeaders.get("oai-authenticated-user-full-name");
  let fullName: string | null = null;
  if (name && requestHeaders.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
    try { fullName = decodeURIComponent(name); } catch { /* Invalid name encoding must not prevent sign-in. */ }
  }
  return { userId, displayName: fullName || email, email, fullName };
}

export function chatGPTSignInPath(returnTo = "/dashboard") {
  return `/signin-with-chatgpt?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`;
}

export function chatGPTSignOutPath(returnTo = "/") {
  return `/signout-with-chatgpt?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`;
}

function safeReturnPath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://app.local");
    if (url.origin !== "https://app.local") return "/";
    // Dot-segment normalization can turn a local-looking path into a network-path
    // reference. Validate the normalized output before handing it to the host.
    if (/^\/(?:\/|%2f|%5c)/i.test(url.pathname)) return "/";
    if (["/signin-with-chatgpt", "/signout-with-chatgpt", "/callback"].includes(url.pathname)) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return "/"; }
}
