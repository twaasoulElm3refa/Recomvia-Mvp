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
      // Only HTTP 200 documents can contribute evidence. Retain the status
      // for diagnostics, but do not read an unusable error or partial body.
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        return {
          url: current.toString(),
          status: response.status,
          contentType: response.headers.get("content-type") || "",
          robotsTag: response.headers.get("x-robots-tag") || "",
          text: "",
          bytes: 0,
        };
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
            // Account for every delivered chunk, including the chunk that
            // exceeds the cap and bytes received before a stream failure.
            if (usage) usage.bytesFetched += value.byteLength;
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
  for (const match of tag.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    // HTML tokenization retains the first attribute and ignores later duplicates.
    // Do not let a later value override an indexing or identity signal.
    if (!Object.hasOwn(output, name)) output[name] = match[2] ?? match[3] ?? match[4] ?? "";
  }
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

// A heading contributes to readiness only if it appears in the rendered body.
// Ignore HTML comments and inert containers (including markup used as examples).
function activeBodyHtml(html: string) {
  const activeMarkup = html.replace(
    /<!--[\s\S]*?-->|<(script|style|template|noscript|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  return activeMarkup.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1] ?? "";
}

// Language is declared on the active document root, not in a copied HTML
// example, commented markup or a tag inside the document body.
function activeDocumentLanguage(html: string) {
  const markup = html.replace(
    /<!--[\s\S]*?-->|<(script|style|template|noscript|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  const beforeContent = markup.split(/<(?:head|body)\b/i, 1)[0];
  const rootTag = beforeContent.match(/<html\b[^>]*>/i)?.[0] ?? "";
  // Decode before trimming so encoded whitespace cannot masquerade as a language.
  // Reject clearly malformed tokens without restricting valid language, script,
  // region, extension or private-use subtags to a fixed locale catalog.
  const language = decodeHtmlEntities(attributes(rootTag).lang || "").trim();
  return /^(?:[a-z]{2,8}(?:-[a-z0-9]{1,8})*|[ix](?:-[a-z0-9]{1,8})+)$/i.test(language) ? language : "";
}

// A meta description or Open Graph field is unambiguous only when a single
// active head tag declares it. Duplicate declarations (including empty or
// identical copies) should not earn readiness points or seed site context.
function metaContent(html: string, target: string) {
  let singleContent: string | null = null;
  for (const tag of activeHeadHtml(html).match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    // HTML attribute values are entity-decoded before their semantic comparison.
    if (decodeHtmlEntities(attrs.name || attrs.property || "").toLowerCase() !== target.toLowerCase()) continue;
    if (singleContent !== null) return "";
    singleContent = decodeHtmlEntities(attrs.content || "").trim();
  }
  return singleContent ?? "";
}

// A crawler-specific noindex is a real indexing block for that crawler, even
// when generic robots directives allow everyone else to index the page.
// Check only the bots whose indexing readiness this score claims to measure.
const INDEXING_CRAWLER_NAMES = new Set(["robots", "googlebot", "bingbot", "recomviabot"]);

function hasRelevantNoindexMeta(html: string) {
  // Robots meta directives are meaningful only in the document head. Ignore
  // lookalike tags in a body, HTML comment or embedded script example.
  const head = activeHeadHtml(html);
  return (head.match(/<meta\b[^>]*>/gi) ?? []).some((tag) => {
    const attrs = attributes(tag);
    if (!INDEXING_CRAWLER_NAMES.has(decodeHtmlEntities(attrs.name || "").trim().toLowerCase())) return false;
    return decodeHtmlEntities(attrs.content || "").toLowerCase()
      .split(/[\s,]+/).some((directive) => directive === "noindex" || directive === "none");
  });
}

// X-Robots-Tag directives apply globally until a crawler prefix appears.
// Subsequent comma-separated directives inherit that prefix. A noindex for
// any major indexing bot or RecomviaBot must not receive crawler-ready points.
function hasRelevantNoindexHeader(header: string) {
  let crawler = "robots";
  for (const part of header.split(",")) {
    let directive = part.trim().toLowerCase();
    const scoped = directive.match(/^([a-z][a-z0-9_-]*)\s*:\s*(.*)$/);
    // These colon-valued directives are not user-agent prefixes. Keep the
    // existing crawler scope so a later noindex/none is not silently ignored.
    if (scoped && !["max-snippet", "max-image-preview", "max-video-preview", "unavailable_after"].includes(scoped[1])) {
      crawler = scoped[1];
      directive = scoped[2].trim();
    }
    if (INDEXING_CRAWLER_NAMES.has(crawler) && /^(?:noindex|none)$/.test(directive)) return true;
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
    if (!decodeHtmlEntities(attrs.rel || "").toLowerCase().split(/\s+/).includes(rel.toLowerCase())) continue;
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
  const href = decodeHtmlEntities(linkHref(html, "canonical")).trim();
  if (!href || href.startsWith("#")) return "";
  try {
    const url = new URL(href, pageUrl);
    if (url.href.includes("#")) return "";
    assertPublicUrl(url);
    // An off-origin canonical credits another site's URL for indexing. It is
    // a valid syndication hint, but not a positive readiness signal for this site.
    if (url.origin !== new URL(pageUrl).origin) return "";
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
      return decodeHtmlEntities(attributes(opening).type || "").trim().toLowerCase() === "application/ld+json";
    });
}

// Evaluate the crawled page's own URL against wildcard robots rules, not
// just a site-wide "Disallow: /". Specific Allow rules win longer matches and
// ties, as they do for major search crawlers. No extra requests are needed.
// Compare equivalent UTF-8 and percent-encoded paths consistently. Decode
// only unreserved ASCII octets: encoded separators and wildcard characters
// must not acquire a different meaning in a robots rule.
function normalizeRobotsPath(value: string) {
  return value.replace(/%[0-9a-fA-F]{2}|[\u0080-\u{10ffff}]/gu, (part) => {
    if (!part.startsWith("%")) return encodeURIComponent(part);
    const character = String.fromCharCode(Number.parseInt(part.slice(1), 16));
    return /^[A-Za-z0-9._~-]$/.test(character) ? character : part.toUpperCase();
  });
}

function robotsRuleMatches(rule: string, path: string) {
  const anchored = rule.endsWith("$");
  const pattern = anchored ? rule.slice(0, -1) : rule;
  if (!pattern.startsWith("/") && !pattern.startsWith("*")) return false;
  const segments = pattern.split("*");
  if (!path.startsWith(segments[0])) return false;
  let cursor = segments[0].length;
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    if (anchored && index === segments.length - 1) {
      return path.endsWith(segment) && path.length - segment.length >= cursor;
    }
    const found = path.indexOf(segment, cursor);
    if (found < 0) return false;
    cursor = found + segment.length;
  }
  return !anchored || cursor === path.length;
}

// A wildcard policy is not enough to establish crawler access: sites can
// allow general robots while blocking Googlebot, Bingbot or RecomviaBot.
// Select the most specific matching user-agent group for each crawler, then
// apply longest-path precedence (Allow wins ties). This is a bounded local
// analysis of the downloaded robots.txt; it never makes additional requests.
function hasRelevantCrawlerPathDisallow(robotsText: string, path: string) {
  type Rule = { kind: "allow" | "disallow"; pattern: string };
  type Group = { agents: string[]; rules: Rule[] };
  const groups: Group[] = [];
  let group: Group = { agents: [], rules: [] };
  let hasRule = false;
  const finishGroup = () => {
    if (group.agents.length) groups.push(group);
    group = { agents: [], rules: [] };
    hasRule = false;
  };

  for (const rawLine of robotsText.split(/\r\n|\n|\r/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    // Blank and comment-only lines are permitted within a robots group.
    // Only a new user-agent after rules starts a new group.
    if (!line) continue;
    const directive = line.match(/^([a-z-]+)\s*:\s*(.*?)\s*$/i);
    if (!directive) continue;
    const key = directive[1].toLowerCase();
    const value = directive[2].trim();
    if (key === "user-agent") {
      if (hasRule) finishGroup();
      if (value) group.agents.push(value.toLowerCase());
      continue;
    }
    if (key !== "allow" && key !== "disallow") continue;
    hasRule = true;
    if (group.agents.length && value) group.rules.push({ kind: key, pattern: normalizeRobotsPath(value) });
  }
  finishGroup();

  const normalizedPath = normalizeRobotsPath(path);
  const isBlockedFor = (crawler: string) => {
    const matches = groups.map((entry) => ({
      group: entry,
      specificity: Math.max(-1, ...entry.agents.map((agent) =>
        agent === "*" ? 0 : crawler.startsWith(agent) ? agent.length : -1)),
    }));
    const bestAgent = Math.max(-1, ...matches.map((entry) => entry.specificity));
    if (bestAgent < 0) return false;
    let bestPath = -1;
    let blocked = false;
    for (const entry of matches) {
      if (entry.specificity !== bestAgent) continue;
      for (const rule of entry.group.rules) {
        if (!robotsRuleMatches(rule.pattern, normalizedPath)) continue;
        const specificity = rule.pattern.replace(/[*$]/g, "").replace(/%[0-9A-F]{2}/g, "_").length;
        if (specificity > bestPath || (specificity === bestPath && rule.kind === "allow")) {
          bestPath = specificity;
          blocked = rule.kind === "disallow";
        }
      }
    }
    return blocked;
  };

  return ["googlebot", "bingbot", "recomviabot"].some(isBlockedFor);
}

function plainText(html: string) {
  return decodeHtmlEntities(
    html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
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
  // Only a complete HTTP 200 document is valid homepage evidence. Other 2xx
  // statuses may describe accepted/pending work, no content or a partial reply,
  // even when they carry a branded HTML placeholder. Do not crawl auxiliaries.
  if (page.status !== 200) {
    throw new Error(`The website returned HTTP ${page.status}; a complete HTTP 200 page is required.`);
  }
  // A successful status and an HTML Content-Type do not prove that the
  // homepage contains a document. Reject empty/plain-text placeholders before
  // spending requests on robots.txt or sitemap.xml. Keep support for documents
  // with omitted optional <html> tags, but ignore inert markup examples.
  const documentMarkup = page.text.replace(
    /<!--[\s\S]*?-->|<(script|style|template|noscript|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  if (!/<(?:html|head|body)\b/i.test(documentMarkup) ||
      (!page.contentType.toLowerCase().includes("text/html") && !page.text.match(/<!doctype html|<html\b/i))) {
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
  // A fallback may start with an HTML comment or an ordinary HTML fragment
  // instead of a document root. Plain robots comments start with "#"; keep
  // accepting genuine text policies even if a server mislabels their MIME.
  const robotsIsHtml = Boolean(robots && /^\s*(?:<!--|<!doctype\s+html\b|<(?:html|head|body|title|meta|link|script|style|div|main|section|p|h[1-6])\b)/i.test(robots.text));
  // A JSON API/error fallback is not a robots policy either. Inspect the
  // bounded body rather than trusting its MIME type; a genuinely empty
  // robots.txt or a mislabeled text policy remains valid.
  let robotsIsJson = false;
  if (robots && /^\s*[\[{]/.test(robots.text)) {
    try {
      const parsed: unknown = JSON.parse(robots.text);
      robotsIsJson = parsed !== null && typeof parsed === "object";
    } catch { /* Malformed non-directive lines alone do not invalidate a text policy. */ }
  }
  const robotsReadable = Boolean(robots && robots.status === 200 && !robotsIsHtml && !robotsIsJson);
  let sitemapUrl = new URL("/sitemap.xml", origin);
  if (robotsReadable && robots) {
    // Sitemap directives are line-scoped. Ignore empty/commented values and
    // continue past unusable hints to the first safe same-origin candidate.
    for (const rawLine of robots.text.split(/\r\n|\n|\r/)) {
      const hint = rawLine.replace(/#.*/, "").trim().match(/^sitemap:\s*(\S+)$/i)?.[1];
      if (!hint) continue;
      try {
        const hinted = new URL(hint, origin);
        assertPublicUrl(hinted);
        if (hinted.origin !== origin) continue;
        sitemapUrl = hinted;
        break;
      } catch { /* Try the next hint, or use the default. */ }
    }
  }
  let sitemap: Awaited<ReturnType<typeof fetchText>> | null = null;
  try { sitemap = await fetchText(sitemapUrl, MAX_AUX_BYTES, "application/xml,text/xml,text/plain,*/*;q=0.1", origin, usage); } catch { sitemap = null; }

  const html = page.text;
  // Count and analyze rendered body copy only. Head markup, commented examples,
  // and inert script/template content are not visible evidence of page depth.
  const text = plainText(activeBodyHtml(html));
  // Only a single title in the active document head is an extractable SEO
  // signal. Body tags, commented examples and duplicate titles must not
  // inflate the score or influence discovered business context.
  const titleTags = activeHeadHtml(html).match(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi) ?? [];
  const title = titleTags.length === 1
    ? plainText(titleTags[0].replace(/^<title\b[^>]*>/i, "").replace(/<\/title\s*>$/i, ""))
    : "";
  const description = metaContent(html, "description");
  const canonical = validatedCanonicalUrl(html, page.url);
  const htmlLang = activeDocumentLanguage(html);
  const visibleBody = activeBodyHtml(html);
  const h1Count = (visibleBody.match(/<h1\b[^>]*>/gi) || []).length;
  // Empty headings do not frame a subject, even if their markup is present.
  // Keep the structural count so an extra empty H1 cannot earn a clean pass.
  const nonemptyH1Count = Array.from(visibleBody.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi))
    .filter((match) => plainText(match[1]).trim().length > 0).length;
  const jsonLdBlocks = activeJsonLdScripts(html);
  // A script tag does not prove valid structured data. Parse each bounded JSON-LD
  // block independently so malformed markup cannot inflate readiness or entity scores.
  // A JSON object carrying only @context or @id is not evidence of a typed
  // structured-data entity. Require a nonempty @type on a top-level node or
  // inside its @graph, including supported arrays, before awarding readiness.
  const hasTypedJsonLdNode = (value: unknown, depth = 0): boolean => {
    if (depth > 16 || !value || typeof value !== "object") return false;
    if (Array.isArray(value)) return value.some((item) => hasTypedJsonLdNode(item, depth + 1));
    const node = value as Record<string, unknown>;
    const declared = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
    if (declared.some((type) => typeof type === "string" && type.trim().length > 0)) return true;
    return hasTypedJsonLdNode(node["@graph"], depth + 1);
  };
  const parsedJsonLd = jsonLdBlocks.flatMap((block) => {
    const raw = block.replace(/^<script\b[^>]*>/i, "").replace(/<\/script\s*>$/i, "").trim();
    try {
      const data: unknown = JSON.parse(raw);
      if (hasTypedJsonLdNode(data)) return [data];
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
  // Detect question-led headings rather than substrings in ordinary words
  // (e.g. "Business services"). Extract visible text so inline formatting and
  // HTML entities do not hide real English or Arabic question headings.
  const hasQuestionHeadings = Array.from(visibleBody.matchAll(/<h([2-4])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)).some((heading) => {
    const label = plainText(heading[2]).trim();
    return /[?؟]$/.test(label) ||
      /^(?:(?:what|how|why|when|where|who|can|does|do|did|is|are|will|should|could|would|which|whose|whom|has|have)\b|(?:ما|ماذا|كيف|لماذا|هل|متى|أين|اين|من|كم|أي)(?=\s|[?؟]))/iu.test(label);
  });
  const words = text ? text.split(/\s+/).length : 0;
  const globallyBlocked = robotsReadable && robots ? hasRelevantCrawlerPathDisallow(robots.text, finalUrl.pathname + finalUrl.search) : false;
  const metaNoindex = hasRelevantNoindexMeta(html);
  const headerNoindex = hasRelevantNoindexHeader(page.robotsTag);
  const robotsHealthy = robotsReadable && !globallyBlocked && !metaNoindex && !headerNoindex;
  // Only a complete successful sitemap response can establish discovery readiness.
  const sitemapHealthy = Boolean(sitemap && sitemap.status === 200 && hasSitemapRootDocument(sitemap.text));
  // Identity signals and extra-page crawl candidates must come from actual
  // body anchors, not commented-out links, scripts, templates or page examples.
  const bodyAnchors = visibleBody.match(/<a\b[^>]*>/gi) ?? [];
  const hasIdentityLink = bodyAnchors.some((tag) => {
    const href = decodeHtmlEntities(attributes(tag).href || "");
    if (!href) return false;
    try {
      const target = new URL(href, page.url);
      // An external company's About page does not identify this website.
      if (target.origin !== origin || target.username || target.password) return false;
      if (/(?:\/about(?:[-_/]|$)|\/contact(?:[-_/]|$)|\/company(?:[-_/]|$))/i.test(target.pathname)) return true;
      // URL.pathname percent-encodes Arabic slugs. Decode each segment
      // independently so an encoded slash cannot manufacture a new path.
      return target.pathname.split("/").some((segment) => {
        try {
          const slug = decodeURIComponent(segment).replace(/[_\s]+/g, "-");
          return /^(?:عن-?(?:الشركة|الموقع|المنصة|المؤسسة)|من-?نحن|اتصل-?بنا|تواصل-?معنا)$/.test(slug);
        } catch { return false; }
      });
    } catch { return false; }
  });
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
  add({ code: "html_language", category: "Technical AEO", severity: "medium", status: htmlLang ? "pass" : "fail", title: "Document language is declared", explanation: "The document language helps systems interpret the content and market context correctly.", evidence: htmlLang ? `lang=${htmlLang}` : "The html element has no usable lang attribute.", sourceUrl: page.url, weight: 5, awardedPoints: htmlLang ? 5 : 0 });
  const h1Points = nonemptyH1Count === 0 ? 0 : h1Count === 1 ? 6 : 3;
  add({ code: "primary_heading", category: "Content readiness", severity: "medium", status: h1Points === 6 ? "pass" : h1Points ? "partial" : "fail", title: "A single primary heading frames the page", explanation: "A stable primary heading makes the central subject easier to extract.", evidence: `${h1Count} H1 element${h1Count === 1 ? "" : "s"} found; ${nonemptyH1Count} with readable text.`, sourceUrl: page.url, weight: 6, awardedPoints: h1Points });
  add({ code: "structured_data", category: "Technical AEO", severity: "medium", status: parsedJsonLd.length ? "pass" : "fail", title: "Parseable JSON-LD structured data is present", explanation: "Structured data supplies explicit machine-readable facts, but it must match visible content.", evidence: `${parsedJsonLd.length} parseable JSON-LD block${parsedJsonLd.length === 1 ? "" : "s"} found (${jsonLdBlocks.length} inspected).`, sourceUrl: page.url, weight: 8, awardedPoints: parsedJsonLd.length ? 8 : 0 });
  add({ code: "organization_entity", category: "Authority & entity", severity: "high", status: hasOrganization ? "pass" : "fail", title: "Organization entity is declared", explanation: "Organization markup can clarify the primary brand entity and connect consistent identifiers.", evidence: hasOrganization ? "Organization type found in JSON-LD." : "No Organization type was found in JSON-LD.", sourceUrl: page.url, weight: 8, awardedPoints: hasOrganization ? 8 : 0 });
  const answerReady = hasFaq || hasQuestionHeadings;
  add({ code: "answer_structure", category: "Content readiness", severity: "medium", status: answerReady ? "pass" : "fail", title: "Question-and-answer structure is discoverable", explanation: "Direct question headings and self-contained answers improve answer extraction for relevant queries.", evidence: hasFaq ? "FAQPage structured data found." : hasQuestionHeadings ? "Question-led headings found in visible HTML." : "No FAQPage schema or question-led headings were detected.", sourceUrl: page.url, weight: 8, awardedPoints: answerReady ? 8 : 0 });
  const contentPoints = words >= 300 ? 8 : words >= 100 ? 4 : 0;
  add({ code: "content_depth", category: "Content readiness", severity: "medium", status: contentPoints === 8 ? "pass" : contentPoints ? "partial" : "fail", title: "The page exposes enough readable context", explanation: "Thin pages often lack the facts and distinctions needed for confident understanding.", evidence: `Approximately ${words.toLocaleString("en-US")} visible words detected.`, sourceUrl: page.url, weight: 8, awardedPoints: contentPoints });
  add({ code: "robots_policy", category: "Technical AEO", severity: "critical", status: robotsHealthy ? "pass" : "fail", title: "Crawler discovery and indexing are permitted", explanation: "A readable robots policy and homepage indexing directives should permit major search crawlers and the scan crawler to access the page.", evidence: metaNoindex ? "Homepage meta robots requests noindex/none." : headerNoindex ? "Homepage X-Robots-Tag requests noindex/none." : robots ? `HTTP ${robots.status}${robotsIsHtml ? " · HTML fallback is not robots.txt" : robotsIsJson ? " · JSON fallback is not robots.txt" : globallyBlocked ? " · target path blocked by crawler-specific or wildcard robots rules" : ""}` : "robots.txt could not be retrieved.", sourceUrl: metaNoindex || headerNoindex ? page.url : robotsUrl.toString(), weight: 7, awardedPoints: robotsHealthy ? 7 : 0 });
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
  // A response alone is not sitemap evidence: errors, HTML fallbacks and
  // incomplete XML must not increase the reported confidence.
  const confidence = Math.min(92, 72 + (robotsReadable ? 5 : 0) + (sitemapHealthy ? 5 : 0) + (parsedJsonLd.length ? 4 : 0) + (page.status === 200 ? 4 : 0));
  // Discovery must use the same active head/body evidence as readiness scoring.
  // Comments, code samples and inert containers cannot identify a business.
  const discoveryHead = activeHeadHtml(html);
  const discoveryBody = activeBodyHtml(html).replace(/<(?:meta|link)\b[^>]*>/gi, "");
  const discoveryJsonLd = activeJsonLdScripts(html).map((script) => {
    const opening = script.match(/^<script\b[^>]*>/i)?.[0] ?? "";
    const payload = script.slice(opening.length).replace(/<\/script\s*>$/i, "");
    // Preserve JSON-LD while preventing embedded HTML examples from looking
    // like active metadata or navigation to downstream string extractors.
    // The active-script filter has already validated the type. Normalize the
    // opening tag for discovery, which accepts quoted JSON-LD MIME types.
    // Keep the raw JSON payload (HTML entities are not decoded in script data).
    return '<script type="application/ld+json">' + payload.replace(/</g, "\\u003c").replace(/>/g, "\\u003e") + "</script>";
  }).join("");
  const discoveryHtml = "<head>" + discoveryHead + "</head><body>" + discoveryBody + "</body>" + discoveryJsonLd;
  const discoveredContext = discoverWebsiteContext({
    sourceUrl: source.toString(), finalUrl: page.url, title, description, htmlLang, html: discoveryHtml, visibleText: text,
  });
  const identityCandidates = discoverWebsiteIdentityCandidates({
    finalUrl: page.url,
    title,
    html: discoveryHtml,
  });

  const internalLinks: string[] = [];
  for (const tag of bodyAnchors) {
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
