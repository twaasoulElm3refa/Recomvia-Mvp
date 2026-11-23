import {
  discoverWebsiteContext,
  discoverWebsiteIdentityCandidates,
  type DiscoveredSiteContext,
  type WebsiteIdentityCandidate,
} from "./ai-visibility";
import { decodeHtmlEntities } from "./answer-text";

export const READINESS_METHODOLOGY_VERSION = "readiness-v0.1";

export type ReadinessFinding = {
  code: string;
  category: "Technical AEO" | "Content readiness" | "Authority & entity";
  severity: "critical" | "high" | "medium" | "low";
  status: "pass" | "partial" | "fail";
  title: string;
  explanation: string;
  evidence: string;
  sourceUrl: string;
  weight: number;
  awardedPoints: number;
  sortOrder: number;
};

export type LiveReadinessResult = {
  sourceUrl: string;
  finalUrl: string;
  httpStatus: number;
  readinessScore: number;
  confidence: number;
  issueCount: number;
  criticalCount: number;
  bytesFetched: number;
  requestCount: number;
  methodologyVersion: string;
  actualVisibilityStatus: "not_measured";
  discoveredContext: DiscoveredSiteContext;
  identityCandidates: WebsiteIdentityCandidate[];
  categoryScores: Record<ReadinessFinding["category"], number>;
  findings: ReadinessFinding[];
  internalLinks: string[];
  pageText: string;
};

const MAX_HTML_BYTES = 1_500_000;
const MAX_AUX_BYTES = 350_000;

function blockedIpv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  // Exclude IANA special-use networks, not just RFC1918 and loopback.
  // Protocol-assignment, documentation, deprecated anycast and benchmarking
  // addresses are not valid public crawl destinations.
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113);
}

function assertPublicUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only HTTP and HTTPS websites can be analyzed.");
  if (url.username || url.password) throw new Error("Website credentials are not accepted in the scan URL.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("Only standard web ports can be analyzed.");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host.endsWith(".internal") || host.endsWith(".lan") || host.includes(":") || blockedIpv4(host)) {
    throw new Error("This address is not a public website.");
  }
}

export function normalizeWebsiteInput(input: string) {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 500 || /\s/.test(trimmed)) throw new Error("Enter a valid public website address.");
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error("Enter a valid public website address.");
  }
  url.hash = "";
  assertPublicUrl(url);
  return url;
}

export type CrawlUsage = { requestCount: number; bytesFetched: number };

async function fetchText(startUrl: URL, maxBytes: number, accept: string, requiredOrigin?: string, usage?: CrawlUsage) {
  let current = new URL(startUrl);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    assertPublicUrl(current);
    if (requiredOrigin && current.origin !== requiredOrigin) throw new Error("Cross-origin page crawl blocked");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let response: Response;
    try {
      if (usage) usage.requestCount++;
      response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: accept,
          "User-Agent": "RecomviaBot/0.1 (+https://recomvia.ai/methodology)",
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        // A redirect may carry a streaming body. Cancel it before following the
        // Location so repeated redirects cannot leave downloads running.
        await response.body?.cancel().catch(() => undefined);
        const location = response.headers.get("location");
        if (!location) throw new Error("The website returned an incomplete redirect.");
        current = new URL(location, current);
        continue;
      }
      const announcedLength = Number(response.headers.get("content-length") || "0");
      if (announcedLength > maxBytes) {
        // A rejected Content-Length still has a live response body. Stop it
        // before failing so oversized sites cannot keep downloads active.
        await response.body?.cancel().catch(() => undefined);
        throw new Error("The response is larger than the scan safety limit.");
      }
      // Content-Length may be absent or false. Never buffer an unbounded crawl
      // response: enforce the byte cap while reading, then stop the remote stream.
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let bytesRead = 0;
      let text = "";
      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytesRead += value.byteLength;
            if (bytesRead > maxBytes) {
              await reader.cancel().catch(() => undefined);
              throw new Error("The response is larger than the scan safety limit.");
            }
            text += decoder.decode(value, { stream: true });
          }
          text += decoder.decode();
        } finally {
          reader.releaseLock();
        }
      }
      if (usage) usage.bytesFetched += bytesRead;
      return {
        url: current.toString(),
        status: response.status,
        contentType: response.headers.get("content-type") || "",
        robotsTag: response.headers.get("x-robots-tag") || "",
        text,
        bytes: bytesRead,
      };
    } finally { clearTimeout(timer); }
  }
  throw new Error("The website redirected too many times.");
}

function attributes(tag: string) {
  const output: Record<string, string> = {};
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) output[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  return output;
}

// SEO meta tags count only when they are active elements in the real document
// head. Comments and inert markup may contain examples that browsers ignore.
function activeHeadHtml(html: string) {
  const activeMarkup = html.replace(
    /<!--[\s\S]*?-->|<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  return activeMarkup.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
}

function metaContent(html: string, target: string) {
  for (const tag of activeHeadHtml(html).match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    if ((attrs.name || attrs.property || "").toLowerCase() === target.toLowerCase())
      return decodeHtmlEntities((attrs.content || "").trim());
  }
  return "";
}

// A homepage can request de-indexing even when robots.txt allows crawling.
// Check all global robots meta tags; named crawler directives are not site-wide.
function hasGlobalNoindexMeta(html: string) {
  // Robots meta directives are meaningful only in the document head. Ignore
  // lookalike tags in a body, HTML comment or embedded script example.
  const head = activeHeadHtml(html);
  return (head.match(/<meta\b[^>]*>/gi) ?? []).some((tag) => {
    const attrs = attributes(tag);
    if ((attrs.name || "").toLowerCase() !== "robots") return false;
    return decodeHtmlEntities(attrs.content || "").toLowerCase()
      .split(/[\s,]+/).some((directive) => directive === "noindex" || directive === "none");
  });
}

// X-Robots-Tag can block indexing even without HTML meta directives. Header
// rules prefixed with a crawler name (for example googlebot:) are not global;
// subsequent comma-separated directives in that rule remain crawler-specific.
function hasGlobalNoindexHeader(header: string) {
  let crawlerSpecific = false;
  for (const part of header.split(",")) {
    let directive = part.trim().toLowerCase();
    const scoped = directive.match(/^[a-z][a-z0-9_-]*\s*:\s*(.*)$/);
    if (scoped) {
      crawlerSpecific = true;
      directive = scoped[1].trim();
    }
    if (!crawlerSpecific && /^(?:noindex|none)$/.test(directive)) return true;
  }
  return false;
}

function linkHref(html: string, rel: string) {
  // Only active link elements in the document head can declare SEO metadata.
  // Remove comments and inert examples before locating the head, so a fake
  // canonical inside a script, template or body cannot earn readiness points.
  const head = activeHeadHtml(html);
  let singleHref: string | null = null;
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    if (!(attrs.rel || "").toLowerCase().split(/\s+/).includes(rel.toLowerCase())) continue;
    // Multiple canonical declarations, even identical ones, should not earn
    // a clean SEO signal: crawlers may ignore conflicting canonical hints.
    if (singleHref !== null) return "";
    singleHref = (attrs.href || "").trim();
  }
  return singleHref || "";
}

// A non-empty canonical href is not necessarily an indexable web URL.
// Resolve legitimate relative canonicals against the final crawl URL, but do
// not award SEO readiness points for fragments, unsafe schemes or local hosts.
function validatedCanonicalUrl(html: string, pageUrl: string) {
  const href = decodeHtmlEntities(linkHref(html, "canonical"));
  if (!href || href.startsWith("#")) return "";
  try {
    const url = new URL(href, pageUrl);
    if (url.hash) return "";
    assertPublicUrl(url);
    return url.toString();
  } catch {
    return "";
  }
}

// Count only JSON-LD scripts present in the active HTML document. Comments
// and inert containers may include copyable examples which crawlers never see
// as structured data; searching raw HTML would award false SEO/entity points.
function activeJsonLdScripts(html: string) {
  const activeMarkup = html.replace(
    /<!--[\s\S]*?-->|<(template|noscript|textarea|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  return (activeMarkup.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi) ?? [])
    .filter((script) => {
      const opening = script.match(/^<script\b[^>]*>/i)?.[0] ?? "";
      return (attributes(opening).type || "").trim().toLowerCase() === "application/ld+json";
    });
}

// A Disallow in a named crawler's group must not be attributed to the
// wildcard group. Keep consecutive User-agent lines in the same group and
// let an equally specific Allow: / take precedence over Disallow: /.
function hasWildcardRootDisallow(robotsText: string) {
  let agents: string[] = [];
  let hasRule = false;
  let rootDisallow = false;
  let rootAllow = false;
  for (const rawLine of robotsText.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const directive = line.match(/^([a-z-]+)\s*:\s*(.*?)\s*$/i);
    if (!directive) continue;
    const key = directive[1].toLowerCase();
    const value = directive[2].trim().toLowerCase();
    if (key === "user-agent") {
      if (hasRule) { agents = []; hasRule = false; }
      if (value) agents.push(value);
      continue;
    }
    if (key !== "allow" && key !== "disallow") continue;
    hasRule = true;
    if (!agents.includes("*") || value !== "/") continue;
    if (key === "allow") rootAllow = true;
    else rootDisallow = true;
  }
  return rootDisallow && !rootAllow;
}

function plainText(html: string) {
  return decodeHtmlEntities(
    html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim(),
  );
}

function clip(value: string, length = 220) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function makeFinding(input: Omit<ReadinessFinding, "sortOrder">, sortOrder: number): ReadinessFinding {
  return { ...input, sortOrder };
}

// XML sitemap readiness needs a sitemap document root, not a substring in an
// HTML error page, a comment, or a truncated response. This is a bounded
// structural check, not a full XML schema validator.
function hasSitemapRootDocument(text: string) {
  const clean = text.replace(/^\uFEFF/, "").trim();
  const prolog = clean.match(/^(?:(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->)\s*)*/)?.[0] ?? "";
  const document = clean.slice(prolog.length);
  const root = document.match(/^<(urlset|sitemapindex)(?=[\s/>])[^>]*>/i);
  if (!root) return false;
  if (root[0].endsWith("/>")) return document === root[0];
  const closing = root[1].toLowerCase() === "urlset"
    ? /<\/urlset\s*>\s*(?:<!--[\s\S]*?-->\s*)*$/i
    : /<\/sitemapindex\s*>\s*(?:<!--[\s\S]*?-->\s*)*$/i;
  return closing.test(document);
}

export async function runLiveReadinessScan(input: string, requiredOrigin?: string, usage: CrawlUsage = { requestCount: 0, bytesFetched: 0 }): Promise<LiveReadinessResult> {
  const source = normalizeWebsiteInput(input);
  const page = await fetchText(source, MAX_HTML_BYTES, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1", requiredOrigin, usage);
  if (!page.contentType.toLowerCase().includes("text/html") && !page.text.match(/<!doctype html|<html\b/i)) {
    throw new Error("The address did not return an HTML webpage.");
  }

  const finalUrl = new URL(page.url);
  const origin = finalUrl.origin;
  const robotsUrl = new URL("/robots.txt", origin);
  let robots: Awaited<ReturnType<typeof fetchText>> | null = null;
  // Auxiliary discovery must remain on the crawled site's final origin.
  // A robots.txt redirect or Sitemap directive must never trigger a request
  // to a third-party host, even when the primary page allows redirects.
  try { robots = await fetchText(robotsUrl, MAX_AUX_BYTES, "text/plain,*/*;q=0.1", origin, usage); } catch { robots = null; }
  // Some site routers return their HTML homepage (HTTP 200) for missing
  // robots.txt files. Neither that page nor an HTTP error is a usable policy
  // or a trustworthy source for sitemap hints.
  const robotsIsHtml = Boolean(robots && /^\uFEFF?\s*(?:<!doctype\s+html\b|<html\b|<head\b|<body\b)/i.test(robots.text));
  const robotsReadable = Boolean(robots && robots.status >= 200 && robots.status < 300 && !robotsIsHtml);
  const sitemapHint = robotsReadable ? robots?.text.match(/^\s*sitemap:\s*(\S+)/im)?.[1] : undefined;
  let sitemapUrl = new URL("/sitemap.xml", origin);
  if (sitemapHint) {
    try {
      const hinted = new URL(sitemapHint, origin);
      if (hinted.origin === origin) sitemapUrl = hinted;
    } catch { /* Fall back to the same-origin default for an invalid hint. */ }
  }
  let sitemap: Awaited<ReturnType<typeof fetchText>> | null = null;
  try { sitemap = await fetchText(sitemapUrl, MAX_AUX_BYTES, "application/xml,text/xml,text/plain,*/*;q=0.1", origin, usage); } catch { sitemap = null; }

  const html = page.text;
  const text = plainText(html);
  // Only a single title in the active document head is an extractable SEO
  // signal. Body tags, commented examples and duplicate titles must not
  // inflate the score or influence discovered business context.
  const titleTags = activeHeadHtml(html).match(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi) ?? [];
  const title = titleTags.length === 1
    ? plainText(titleTags[0].replace(/^<title\b[^>]*>/i, "").replace(/<\/title\s*>$/i, ""))
    : "";
  const description = metaContent(html, "description");
  const canonical = validatedCanonicalUrl(html, page.url);
  const htmlLang = html.match(/<html\b[^>]*\blang\s*=\s*["']?([^\s"'>]+)/i)?.[1] || "";
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  const jsonLdBlocks = activeJsonLdScripts(html);
  // A script tag does not prove valid structured data. Parse each bounded JSON-LD
  // block independently so malformed markup cannot inflate readiness or entity scores.
  const parsedJsonLd = jsonLdBlocks.flatMap((block) => {
    const raw = block.replace(/^<script\b[^>]*>/i, "").replace(/<\/script\s*>$/i, "").trim();
    try {
      const data: unknown = JSON.parse(raw);
      const nodes = Array.isArray(data) ? data : [data];
      if (nodes.some((node) => node !== null && typeof node === "object" &&
          !Array.isArray(node) && Object.keys(node).some((key) => key.startsWith("@")))) {
        return [data];
      }
    } catch { /* Ignore malformed JSON-LD instead of counting the tag as evidence. */ }
    return [];
  });
  const hasJsonLdType = (type: string) => {
    const containsType = (value: unknown, depth = 0): boolean => {
      if (depth > 16 || !value || typeof value !== "object") return false;
      if (Array.isArray(value)) return value.some((item) => containsType(item, depth + 1));
      const node = value as Record<string, unknown>;
      const declared = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
      if (declared.some((item) => typeof item === "string" &&
          (item === type || item === "https://schema.org/" + type || item === "http://schema.org/" + type))) {
        return true;
      }
      return containsType(node["@graph"], depth + 1);
    };
    return parsedJsonLd.some((block) => containsType(block));
  };
  const hasOrganization = hasJsonLdType("Organization");
  const hasFaq = hasJsonLdType("FAQPage");
  const hasQuestionHeadings = /<h[2-4]\b[^>]*>[^<]{0,120}(?:what|how|why|when|where|who|can|does|is|are|ما|ماذا|كيف|لماذا|هل|متى|أين|اين)[^<]*<\/h[2-4]>/i.test(html);
  const words = text ? text.split(/\s+/).length : 0;
  const globallyBlocked = robotsReadable && robots ? hasWildcardRootDisallow(robots.text) : false;
  const metaNoindex = hasGlobalNoindexMeta(html);
  const headerNoindex = hasGlobalNoindexHeader(page.robotsTag);
  const robotsHealthy = robotsReadable && !globallyBlocked && !metaNoindex && !headerNoindex;
  const sitemapHealthy = Boolean(sitemap && sitemap.status >= 200 && sitemap.status < 300 && hasSitemapRootDocument(sitemap.text));
  const hasIdentityLink = /href\s*=\s*["'][^"']*(?:\/about(?:[-_/]|["'#?])|\/contact(?:[-_/]|["'#?])|\/company(?:[-_/]|["'#?])|عن-?ا|اتصل-?بنا)/i.test(html);
  const hasOpenGraph = Boolean(metaContent(html, "og:title") && metaContent(html, "og:description"));

  const findings: ReadinessFinding[] = [];
  let order = 1;
  const add = (finding: Omit<ReadinessFinding, "sortOrder">) => findings.push(makeFinding(finding, order++));

  add({ code: "page_access", category: "Technical AEO", severity: "critical", status: page.status >= 200 && page.status < 400 ? "pass" : "fail", title: "Homepage returns a usable response", explanation: "AI and search crawlers need a stable, successful HTML response before they can interpret the page.", evidence: `HTTP ${page.status} · ${page.contentType || "content type not supplied"}`, sourceUrl: page.url, weight: 15, awardedPoints: page.status >= 200 && page.status < 400 ? 15 : 0 });
  const titlePoints = title.length >= 15 && title.length <= 65 ? 7 : title ? 4 : 0;
  add({ code: "title", category: "Content readiness", severity: "high", status: titlePoints === 7 ? "pass" : titlePoints ? "partial" : "fail", title: "Page title is clear and extractable", explanation: "A concise title helps systems identify the page topic and brand without guessing.", evidence: title ? `${title.length} characters · ${clip(title)}` : "No title element was found.", sourceUrl: page.url, weight: 7, awardedPoints: titlePoints });
  const descriptionPoints = description.length >= 70 && description.length <= 180 ? 7 : description ? 4 : 0;
  add({ code: "meta_description", category: "Content readiness", severity: "medium", status: descriptionPoints === 7 ? "pass" : descriptionPoints ? "partial" : "fail", title: "Meta description summarizes the page", explanation: "A specific description gives retrieval systems a compact statement of the page purpose.", evidence: description ? `${description.length} characters · ${clip(description)}` : "No meta description was found.", sourceUrl: page.url, weight: 7, awardedPoints: descriptionPoints });
  add({ code: "canonical", category: "Technical AEO", severity: "high", status: canonical ? "pass" : "fail", title: "Canonical URL is declared", explanation: "A canonical reduces ambiguity between duplicate URL variants and consolidates discovery signals.", evidence: canonical ? clip(canonical) : "Canonical link is missing or invalid.", sourceUrl: page.url, weight: 7, awardedPoints: canonical ? 7 : 0 });
  add({ code: "html_language", category: "Technical AEO", severity: "medium", status: htmlLang ? "pass" : "fail", title: "Document language is declared", explanation: "The document language helps systems interpret the content and market context correctly.", evidence: htmlLang ? `lang=${htmlLang}` : "The html element has no lang attribute.", sourceUrl: page.url, weight: 5, awardedPoints: htmlLang ? 5 : 0 });
  const h1Points = h1Count === 1 ? 6 : h1Count > 0 ? 3 : 0;
  add({ code: "primary_heading", category: "Content readiness", severity: "medium", status: h1Points === 6 ? "pass" : h1Points ? "partial" : "fail", title: "A single primary heading frames the page", explanation: "A stable primary heading makes the central subject easier to extract.", evidence: `${h1Count} H1 element${h1Count === 1 ? "" : "s"} found.`, sourceUrl: page.url, weight: 6, awardedPoints: h1Points });
  add({ code: "structured_data", category: "Technical AEO", severity: "medium", status: parsedJsonLd.length ? "pass" : "fail", title: "Parseable JSON-LD structured data is present", explanation: "Structured data supplies explicit machine-readable facts, but it must match visible content.", evidence: `${parsedJsonLd.length} parseable JSON-LD block${parsedJsonLd.length === 1 ? "" : "s"} found (${jsonLdBlocks.length} inspected).`, sourceUrl: page.url, weight: 8, awardedPoints: parsedJsonLd.length ? 8 : 0 });
  add({ code: "organization_entity", category: "Authority & entity", severity: "high", status: hasOrganization ? "pass" : "fail", title: "Organization entity is declared", explanation: "Organization markup can clarify the primary brand entity and connect consistent identifiers.", evidence: hasOrganization ? "Organization type found in JSON-LD." : "No Organization type was found in JSON-LD.", sourceUrl: page.url, weight: 8, awardedPoints: hasOrganization ? 8 : 0 });
  const answerReady = hasFaq || hasQuestionHeadings;
  add({ code: "answer_structure", category: "Content readiness", severity: "medium", status: answerReady ? "pass" : "fail", title: "Question-and-answer structure is discoverable", explanation: "Direct question headings and self-contained answers improve answer extraction for relevant queries.", evidence: hasFaq ? "FAQPage structured data found." : hasQuestionHeadings ? "Question-led headings found in visible HTML." : "No FAQPage schema or question-led headings were detected.", sourceUrl: page.url, weight: 8, awardedPoints: answerReady ? 8 : 0 });
  const contentPoints = words >= 300 ? 8 : words >= 100 ? 4 : 0;
  add({ code: "content_depth", category: "Content readiness", severity: "medium", status: contentPoints === 8 ? "pass" : contentPoints ? "partial" : "fail", title: "The page exposes enough readable context", explanation: "Thin pages often lack the facts and distinctions needed for confident understanding.", evidence: `Approximately ${words.toLocaleString("en-US")} visible words detected.`, sourceUrl: page.url, weight: 8, awardedPoints: contentPoints });
  add({ code: "robots_policy", category: "Technical AEO", severity: "critical", status: robotsHealthy ? "pass" : "fail", title: "Crawler discovery and indexing are permitted", explanation: "A readable robots policy and homepage indexing directives should permit general search crawlers to discover and index the site.", evidence: metaNoindex ? "Homepage meta robots requests noindex/none." : headerNoindex ? "Homepage X-Robots-Tag requests noindex/none." : robots ? `HTTP ${robots.status}${robotsIsHtml ? " · HTML fallback is not robots.txt" : globallyBlocked ? " · broad Disallow: / detected" : ""}` : "robots.txt could not be retrieved.", sourceUrl: metaNoindex || headerNoindex ? page.url : robotsUrl.toString(), weight: 7, awardedPoints: robotsHealthy ? 7 : 0 });
  add({ code: "xml_sitemap", category: "Technical AEO", severity: "high", status: sitemapHealthy ? "pass" : "fail", title: "XML sitemap is available", explanation: "A valid sitemap gives crawlers a reliable inventory of canonical content URLs.", evidence: sitemap ? `HTTP ${sitemap.status} · ${sitemapHealthy ? "sitemap root document detected" : "no complete sitemap root document detected"}` : "A sitemap could not be retrieved.", sourceUrl: sitemapUrl.toString(), weight: 7, awardedPoints: sitemapHealthy ? 7 : 0 });
  add({ code: "identity_paths", category: "Authority & entity", severity: "medium", status: hasIdentityLink ? "pass" : "fail", title: "Identity and contact paths are visible", explanation: "Clear company and contact paths help users and systems verify who is responsible for the site.", evidence: hasIdentityLink ? "An About, Company, or Contact path was found." : "No clear About, Company, or Contact path was detected in homepage links.", sourceUrl: page.url, weight: 6, awardedPoints: hasIdentityLink ? 6 : 0 });
  add({ code: "open_graph", category: "Content readiness", severity: "low", status: hasOpenGraph ? "pass" : "fail", title: "Share metadata describes the page", explanation: "Open Graph metadata provides another consistent summary when the page is shared or referenced.", evidence: hasOpenGraph ? "og:title and og:description were found." : "og:title or og:description is missing.", sourceUrl: page.url, weight: 6, awardedPoints: hasOpenGraph ? 6 : 0 });

  const readinessScore = Math.max(0, Math.min(100, findings.reduce((sum, finding) => sum + finding.awardedPoints, 0)));
  const categories = ["Technical AEO", "Content readiness", "Authority & entity"] as const;
  const categoryScores = Object.fromEntries(categories.map((category) => {
    const rows = findings.filter((finding) => finding.category === category);
    const possible = rows.reduce((sum, finding) => sum + finding.weight, 0);
    const awarded = rows.reduce((sum, finding) => sum + finding.awardedPoints, 0);
    return [category, possible ? Math.round((awarded / possible) * 100) : 0];
  })) as LiveReadinessResult["categoryScores"];
  const issueRows = findings.filter((finding) => finding.status !== "pass");
  const requestCount = usage.requestCount;
  const bytesFetched = usage.bytesFetched;
  const confidence = Math.min(92, 72 + (robotsReadable ? 5 : 0) + (sitemap ? 5 : 0) + (parsedJsonLd.length ? 4 : 0) + (page.status === 200 ? 4 : 0));
  const discoveredContext = discoverWebsiteContext({
    sourceUrl: source.toString(), finalUrl: page.url, title, description, htmlLang, html, visibleText: text,
  });
  const identityCandidates = discoverWebsiteIdentityCandidates({
    finalUrl: page.url,
    title,
    html,
  });

  const internalLinks: string[] = [];
  for (const tag of html.match(/<a\b[^>]*>/gi) || []) {
    try {
      const raw = attributes(tag).href;
      if (!raw || /^(?:mailto|tel|javascript|data):/i.test(raw)) continue;
      const link = normalizeWebsiteInput(new URL(decodeHtmlEntities(raw), page.url).toString());
      if (link.origin !== finalUrl.origin || link.search || link.toString() === page.url || /\.(?:pdf|zip|png|jpe?g|gif|svg|mp4)$/i.test(link.pathname)) continue;
      if (!internalLinks.includes(link.toString())) internalLinks.push(link.toString());
      if (internalLinks.length >= 40) break;
    } catch { /* Skip invalid or private links. */ }
  }
  return {
    internalLinks, pageText: text.slice(0, 16000),
    sourceUrl: source.toString(), finalUrl: page.url, httpStatus: page.status, readinessScore, confidence,
    issueCount: issueRows.length,
    criticalCount: issueRows.filter((finding) => finding.severity === "critical").length,
    bytesFetched, requestCount, methodologyVersion: READINESS_METHODOLOGY_VERSION,
    actualVisibilityStatus: "not_measured", discoveredContext, identityCandidates, categoryScores, findings,
  };
}
