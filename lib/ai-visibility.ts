import { createId } from "./ids";
import type {
  EngineAdapter,
  EngineCitation,
  EngineProviderError,
  EngineResponse,
  EngineSource,
  EngineSurfaceType,
  EngineUsage,
} from "./ai-engines/engine-adapter";
import { decodeHtmlEntities, sanitizeProviderAnswer } from "./answer-text";

export type ConfidenceValue<T> = {
  value: T;
  confidence: number;
  evidence: string[];
};

export type DiscoveredSiteContext = {
  brand: ConfidenceValue<string>;
  description: ConfidenceValue<string>;
  category: ConfidenceValue<string>;
  offerings: ConfidenceValue<string[]>;
  languages: ConfidenceValue<string[]>;
  markets: ConfidenceValue<string[]>;
  intents: ConfidenceValue<string[]>;
  competitors: ConfidenceValue<string[]>;
  sourceUrl: string;
};

export type IntentPrompt = {
  id: string;
  intent:
    | "discovery"
    | "comparison"
    | "recommendation"
    | "alternatives"
    | "identity"
    | "topic"
    | "entity_resolution";
  question: string;
  language: string;
  country: string;
};

export type VisibilityEvidence = {
  id: string;
  type:
    | "brand_mention"
    | "recommendation"
    | "list_position"
    | "competitor_mention"
    | "citation";
  entityName: string | null;
  excerpt: string;
  position: number | null;
  sourceUrl: string | null;
  metadata: Record<string, unknown>;
};

export type VisibilityAnalysis = {
  brandDetected: string;
  brandVisible: boolean;
  mentionCount: number;
  recommendationStatus:
    | "recommended"
    | "listed"
    | "mentioned"
    | "absent"
    | "unavailable";
  recommendationPosition: number | null;
  competitorsMentioned: string[];
  evidence: VisibilityEvidence[];
};

export type VisibilityEngineRun = {
  id: string;
  provider: string;
  model: string;
  surfaceType: EngineSurfaceType;
  promptId: string;
  intent: IntentPrompt["intent"];
  prompt: string;
  language: string;
  country: string;
  responseText: string | null;
  sources: EngineSource[];
  citations: EngineCitation[];
  analysis: VisibilityAnalysis;
  usage: EngineUsage;
  estimatedCostMicros: number | null;
  durationMs: number;
  error: EngineProviderError | null;
  retryCount: number;
  timestamp: string;
  providerRunId: string | null;
};

export type ActualVisibilityMeasurement = {
  status: "measured" | "partial" | "failed" | "not_configured";
  score: number | null;
  confidence: number;
  engineRuns: VisibilityEngineRun[];
  prompts: IntentPrompt[];
};

type WebsiteContextInput = {
  sourceUrl: string;
  finalUrl: string;
  title: string;
  description: string;
  htmlLang: string;
  html: string;
  visibleText: string;
};

export type WebsiteIdentityCandidate = {
  name: string;
  evidence: string[];
};

function unique(values: string[]) {
  const seen = new Set<string>();
  return values
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => {
      const key = value.toLocaleLowerCase();
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function clip(value: string, length = 260) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function jsonLdObjects(html: string): unknown[] {
  const objects: unknown[] = [];
  for (const match of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const parsed = JSON.parse(match[1].trim());
      objects.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      /* Invalid page markup is ignored during discovery. */
    }
  }
  return objects;
}

function walkJson(
  value: unknown,
  visit: (object: Record<string, unknown>) => void,
) {
  if (Array.isArray(value))
    return value.forEach((item) => walkJson(item, visit));
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  visit(object);
  Object.values(object).forEach((item) => walkJson(item, visit));
}

function schemaTypes(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string")
    : typeof value === "string"
      ? [value]
      : [];
}

function hostnameBrand(url: string) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const first = host.split(".")[0].replace(/[-_]+/g, " ");
  return first.replace(/\b\w/g, (character) => character.toUpperCase());
}

function metaContent(html: string, key: string) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = tag
      .match(/(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1]
      ?.toLowerCase();
    if (name !== key.toLowerCase()) continue;
    return decodeHtmlEntities(
      tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1]?.trim() || "",
    );
  }
  return "";
}

const SCHEMA_VOCABULARY = new Set(
  [
    "action",
    "article",
    "author",
    "brand",
    "blogposting",
    "breadcrumblist",
    "contactpoint",
    "faqpage",
    "itemlist",
    "listitem",
    "localbusiness",
    "mainentity",
    "mainentityofpage",
    "newsarticle",
    "organization",
    "offer",
    "person",
    "postaladdress",
    "potentialaction",
    "product",
    "publisher",
    "sameas",
    "searchaction",
    "searchresultspage",
    "service",
    "softwareapplication",
    "thing",
    "website",
    "webpage",
  ].map((value) => value.toLowerCase()),
);

const HTML_VOCABULARY = new Set([
  "a",
  "article",
  "aside",
  "body",
  "button",
  "div",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "head",
  "header",
  "html",
  "img",
  "input",
  "link",
  "main",
  "meta",
  "nav",
  "script",
  "section",
  "span",
  "style",
  "title",
]);

const GENERIC_PAGE_COPY =
  /^(?:home|welcome|welcome to|about|about us|company|our company|services?|products?|solutions?|features?|learn more|read more|get started|contact|contact us|who we are|what we do|الرئيسية|مرحب[اأ]|من نحن|عن الشركة|خدماتنا|منتجاتنا|حلولنا|اعرف المزيد|اقرأ المزيد|تواصل معنا)$/iu;

/** Reject schema, markup and implementation vocabulary without relying only on a list. */
export function isTechnicalWebsiteVocabulary(value: string) {
  const clean = decodeHtmlEntities(value).trim();
  if (!clean) return true;
  const compact = clean.toLocaleLowerCase().replace(/[\s_.:/-]+/g, "");
  if (SCHEMA_VOCABULARY.has(compact) || HTML_VOCABULARY.has(compact))
    return true;
  const vocabularyTokens = clean
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.toLocaleLowerCase())
    .filter(Boolean);
  if (
    vocabularyTokens.some(
      (token) =>
        SCHEMA_VOCABULARY.has(token) &&
        !["brand", "product", "service"].includes(token),
    )
  )
    return true;
  if (/^https?:\/\/schema\.org\//i.test(clean)) return true;
  if (/^(?:og|twitter):[a-z:_-]+$/i.test(clean)) return true;
  if (/^<\/?[a-z][^>]*>$/i.test(clean)) return true;
  // Schema types and properties commonly use a single PascalCase/camelCase token.
  if (
    !/\s/u.test(clean) &&
    (/^[a-z]+(?:[A-Z][a-z\d]*)+$/u.test(clean) ||
      /^[A-Z][a-z\d]+(?:[A-Z][A-Za-z\d]*)+$/u.test(clean) ||
      /^[A-Z][A-Za-z\d]*(?:Action|Page|Article|Posting|List|Item|Address|Point|Property)$/u.test(
        clean,
      ))
  )
    return true;
  const implementationTerm =
    /\b(?:schema(?:\.org)?|json[ -]?ld|structured data|html(?: tag)?|meta(?:data| tag)?|canonical(?: url)?|open graph|hreflang|robots\.txt|xml sitemap|dom|css selector|http status)\b/iu;
  const genuineService =
    /\b(?:services?|consulting|consultancy|agency|audits?|optimization|implementation|development|platform|software|solutions?)\b|(?:خدمات|استشارات|وكالة|تدقيق|تحسين|تطوير|منصة|برمجيات|حلول)/iu;
  return implementationTerm.test(clean) && !genuineService.test(clean);
}

export function isBusinessContextCandidate(value: string) {
  const clean = decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
  if (
    clean.length < 3 ||
    clean.length > 140 ||
    GENERIC_PAGE_COPY.test(clean) ||
    isTechnicalWebsiteVocabulary(clean) ||
    !/[\p{L}]/u.test(clean)
  )
    return false;
  return clean.split(/\s+/).length <= 18;
}

function visibleTextFromFragment(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function tagTexts(html: string, tagPattern: string) {
  const values: string[] = [];
  const expression = new RegExp(
    `<(?:${tagPattern})\\b[^>]*>([\\s\\S]*?)<\\/(?:${tagPattern})>`,
    "gi",
  );
  for (const match of html.matchAll(expression)) {
    const text = visibleTextFromFragment(match[1]);
    if (text) values.push(text);
  }
  return unique(values);
}

function removeBrandPrefix(value: string, brand: string) {
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value
    .replace(new RegExp(`^${escaped}\\s*(?:[-–—|:]\\s*)?`, "iu"), "")
    .replace(
      /^(?:we (?:provide|offer|build|help|specialize in)|our (?:company|business) (?:provides|offers)|a |an |the |نقدم|نوفر|نساعد|شركة متخصصة في|منصة متخصصة في)\s+/iu,
      "",
    )
    .replace(/[.!?،]+$/u, "")
    .trim();
}

function visibleBusinessCandidates(html: string, brand: string) {
  const paragraphCandidates = tagTexts(html, "p")
    .filter((value) =>
      /\b(?:provide|offer|speciali[sz]e|platform for|software for|services? for|helps?|solutions? for)\b|(?:نقدم|نوفر|متخصص|منصة|برمجيات|خدمات|حلول|نساعد)/iu.test(
        value,
      ),
    )
    .map((value) => ({
      value: removeBrandPrefix(value, brand),
      confidence: 92,
      evidence: "Visible homepage business copy",
    }));
  const headings = [
    ...tagTexts(html, "h1").map((value) => ({
      value: removeBrandPrefix(value, brand),
      confidence: 88,
      evidence: "Homepage H1",
    })),
    ...tagTexts(html, "h2|h3").map((value) => ({
      value: removeBrandPrefix(value, brand),
      confidence: 80,
      evidence: "Relevant homepage H2/H3",
    })),
  ];
  return [...paragraphCandidates, ...headings].filter((candidate) =>
    isBusinessContextCandidate(candidate.value),
  );
}

function identityKey(value: string) {
  return decodeHtmlEntities(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{Z}\p{M}]/gu, "");
}

function sameWebsite(value: unknown, finalUrl: string) {
  if (typeof value !== "string") return false;
  try {
    const candidate = new URL(value, finalUrl).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    const submitted = new URL(finalUrl).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    return candidate === submitted;
  } catch {
    return false;
  }
}

/** Resolve a website only from evidence attached to the submitted domain. */
export function discoverWebsiteIdentityCandidates(
  input: Pick<WebsiteContextInput, "html" | "title" | "finalUrl">,
): WebsiteIdentityCandidate[] {
  const anchoredOrganizations: WebsiteIdentityCandidate[] = [];
  const unanchoredOrganizations: WebsiteIdentityCandidate[] = [];
  walkJson(jsonLdObjects(input.html), (object) => {
    const types = schemaTypes(object["@type"]);
    if (
      !types.some((type) =>
        ["Organization", "Corporation", "LocalBusiness", "Brand"].includes(
          type,
        ),
      ) ||
      typeof object.name !== "string" ||
      !object.name.trim()
    )
      return;
    const references = [
      object.url,
      object["@id"],
      ...(Array.isArray(object.sameAs) ? object.sameAs : [object.sameAs]),
    ];
    const hasReference = references.some(
      (value) => typeof value === "string" && value.trim(),
    );
    const anchored = references.some((value) =>
      sameWebsite(value, input.finalUrl),
    );
    if (hasReference && !anchored) return;
    (anchored ? anchoredOrganizations : unanchoredOrganizations).push({
      name: decodeHtmlEntities(object.name).trim(),
      evidence: [
        anchored
          ? `Organization structured data anchored to ${new URL(input.finalUrl).hostname}`
          : "Unanchored Organization structured data",
      ],
    });
  });

  const siteName =
    metaContent(input.html, "og:site_name") ||
    metaContent(input.html, "application-name");
  const titleName = decodeHtmlEntities(input.title)
    .split(/\s+[|\u2013\u2014-]\s+/)[0]
    ?.trim();
  const directPageNames = new Set(
    [siteName, titleName].filter(Boolean).map((name) => identityKey(name!)),
  );
  const corroboratedOrganizations = unanchoredOrganizations
    .filter((candidate) => directPageNames.has(identityKey(candidate.name)))
    .map((candidate) => ({
      ...candidate,
      evidence: ["Organization structured data corroborated by submitted page"],
    }));
  const directSignals: WebsiteIdentityCandidate[] = [
    ...anchoredOrganizations,
    ...corroboratedOrganizations,
    ...(siteName ? [{ name: siteName, evidence: ["og:site_name"] }] : []),
    ...(!siteName && titleName
      ? [{ name: titleName, evidence: ["Page title on submitted domain"] }]
      : []),
  ];
  const candidates = directSignals.length
    ? directSignals
    : unanchoredOrganizations.length
      ? [unanchoredOrganizations[0]]
      : [
          {
            name: hostnameBrand(input.finalUrl),
            evidence: ["Submitted hostname"],
          },
        ];
  const merged = new Map<string, WebsiteIdentityCandidate>();
  for (const candidate of candidates) {
    const key = identityKey(candidate.name);
    if (!key) continue;
    const existing = merged.get(key);
    if (existing)
      existing.evidence = unique([...existing.evidence, ...candidate.evidence]);
    else merged.set(key, { ...candidate });
  }
  return [...merged.values()];
}

function anchorOfferings(html: string) {
  const values: string[] = [];
  for (const match of html.matchAll(
    /<a\b[^>]*href\s*=\s*["'][^"']*\/(?:products?|services?|solutions?|platform|features?)(?:[\/?#"'][^"']*)?["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const text = visibleTextFromFragment(match[1]);
    if (
      text.length <= 80 &&
      isBusinessContextCandidate(text)
    )
      values.push(text);
  }
  return unique(values).slice(0, 8);
}

function serviceCardOfferings(html: string) {
  const values: string[] = [];
  for (const match of html.matchAll(
    /<(?:article|div|section)\b[^>]*(?:class|id)\s*=\s*["'][^"']*(?:service|product|solution|offering)[^"']*["'][^>]*>([\s\S]*?)<\/(?:article|div|section)>/gi,
  )) {
    const headings = tagTexts(match[1], "h2|h3|h4");
    for (const heading of headings)
      if (heading.length <= 80 && isBusinessContextCandidate(heading))
        values.push(heading);
  }
  return unique(values).slice(0, 8);
}

function visiblySupports(value: string, visibleText: string) {
  const normalize = (text: string) =>
    decodeHtmlEntities(text)
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const candidate = normalize(value);
  const visible = normalize(visibleText);
  return Boolean(candidate && visible.includes(candidate));
}

function explicitCompetitors(text: string, brand: string) {
  const values: string[] = [];
  const escapedBrand = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const match of text.matchAll(
    new RegExp(
      `(?:${escapedBrand}\\s+vs\\.?|alternatives?\\s+to\\s+${escapedBrand}|compare\\s+${escapedBrand}\\s+(?:with|and))\\s+([\\p{L}\\p{N}][\\p{L}\\p{N} .&'-]{1,50})`,
      "giu",
    ),
  )) {
    values.push((match[1].split(/[|,.;:]/)[0] || "").trim());
  }
  return unique(values)
    .filter((value) => value.toLowerCase() !== brand.toLowerCase())
    .slice(0, 6);
}

function countryFromUrl(url: string) {
  const suffix = new URL(url).hostname.split(".").at(-1)?.toLowerCase();
  const countries: Record<string, string> = {
    ae: "United Arab Emirates",
    sa: "Saudi Arabia",
    eg: "Egypt",
    uk: "United Kingdom",
    de: "Germany",
    fr: "France",
    ca: "Canada",
    au: "Australia",
    in: "India",
  };
  return suffix ? countries[suffix] : undefined;
}

export function discoverWebsiteContext(
  input: WebsiteContextInput,
): DiscoveredSiteContext {
  const structured = jsonLdObjects(input.html);
  const identities = discoverWebsiteIdentityCandidates(input);
  const organizationIdentity = identities.find((candidate) =>
    candidate.evidence.some((evidence) =>
      evidence.startsWith("Organization structured data"),
    ),
  );
  const organizationName = organizationIdentity?.name || "";
  let schemaDescription = "";
  const schemaCategories: string[] = [];
  const schemaOfferings: string[] = [];
  const schemaMarkets: string[] = [];
  walkJson(structured, (object) => {
    const types = schemaTypes(object["@type"]);
    const organizationNode = types.some((type) =>
      ["Organization", "Corporation", "LocalBusiness", "Brand"].includes(
        type,
      ),
    );
    if (
      organizationNode &&
      !schemaDescription &&
      typeof object.description === "string" &&
      visiblySupports(object.description, input.visibleText)
    )
      schemaDescription = decodeHtmlEntities(object.description).trim();
    if (
      typeof object.category === "string" &&
      isBusinessContextCandidate(object.category) &&
      visiblySupports(object.category, input.visibleText)
    )
      schemaCategories.push(decodeHtmlEntities(object.category).trim());
    if (
      ["Product", "Service", "SoftwareApplication", "Offer"].some((type) =>
        types.includes(type),
      ) &&
      typeof object.name === "string" &&
      isBusinessContextCandidate(object.name) &&
      visiblySupports(object.name, input.visibleText)
    )
      schemaOfferings.push(decodeHtmlEntities(object.name).trim());
    for (const field of [object.areaServed, object.addressCountry]) {
      if (typeof field === "string") schemaMarkets.push(field);
      else if (
        field &&
        typeof field === "object" &&
        typeof (field as Record<string, unknown>).name === "string"
      )
        schemaMarkets.push((field as Record<string, unknown>).name as string);
    }
  });

  const siteName =
    metaContent(input.html, "og:site_name") ||
    metaContent(input.html, "application-name");
  const titleCandidate =
    decodeHtmlEntities(input.title).split(/\s+[|\u2013\u2014-]\s+/)[0]?.trim() ||
    "";
  const brand =
    identities[0]?.name ||
    organizationName ||
    siteName ||
    titleCandidate ||
    hostnameBrand(input.finalUrl);
  const visibleCandidates = visibleBusinessCandidates(input.html, brand);
  const navigationOfferings = anchorOfferings(input.html);
  const cardOfferings = serviceCardOfferings(input.html);
  const visibleOfferings = unique([
    ...navigationOfferings,
    ...cardOfferings,
  ]);
  const offerings = unique([...visibleOfferings, ...schemaOfferings]);
  const description =
    input.description ||
    visibleCandidates[0]?.value ||
    schemaDescription ||
    clip(input.visibleText, 260);
  const alternateLanguages = [
    ...input.html.matchAll(/hreflang\s*=\s*["']([^"']+)["']/gi),
  ].map((match) => match[1].split("-")[0]);
  const primaryLanguage =
    input.htmlLang.split("-")[0] ||
    ((input.visibleText.match(/[\u0600-\u06ff]/g)?.length || 0) >
    input.visibleText.length * 0.12
      ? "ar"
      : "en");
  const languages = unique([
    primaryLanguage,
    ...alternateLanguages.filter((value) => value !== "x-default"),
  ]);
  const inferredCountry = countryFromUrl(input.finalUrl);
  const markets = unique([
    ...schemaMarkets,
    ...(inferredCountry ? [inferredCountry] : ["Global"]),
  ]);
  const titleParts = decodeHtmlEntities(input.title)
    .split(/\s+[|\u2013\u2014-]\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const titleSubject = titleParts.length > 1 ? titleParts.at(-1)! : "";
  const metaDescriptionSubject = removeBrandPrefix(
    input.description.split(/[.!?،]/)[0]?.slice(0, 140) || "",
    brand,
  );
  const categoryCandidates = [
    ...visibleCandidates,
    {
      value: titleSubject,
      confidence: 76,
      evidence: "Meta title business phrase",
    },
    {
      value: metaDescriptionSubject,
      confidence: 72,
      evidence: "Meta description business phrase",
    },
    ...navigationOfferings.map((value) => ({
      value,
      confidence: 70,
      evidence: "Product/service navigation label",
    })),
    ...cardOfferings.map((value) => ({
      value,
      confidence: 68,
      evidence: "Visible service/product card",
    })),
    {
      value: schemaDescription,
      confidence: 62,
      evidence: "Visible Organization description corroborated by structured data",
    },
    ...schemaCategories.map((value) => ({
      value,
      confidence: 60,
      evidence: "Visible category corroborated by structured data",
    })),
  ].filter((candidate) => isBusinessContextCandidate(candidate.value));
  const selectedCategory = categoryCandidates[0] || null;
  const category = selectedCategory?.value || "";
  const competitors = explicitCompetitors(input.visibleText, brand);

  return {
    brand: {
      value: brand,
      confidence: organizationIdentity
        ? 94
        : siteName
          ? 88
          : titleCandidate
            ? 72
            : 55,
      evidence: [
        organizationIdentity
          ? organizationIdentity.evidence[0]
          : siteName
            ? "og:site_name"
            : titleCandidate
              ? "Page title"
              : "Hostname",
      ],
    },
    description: {
      value: description,
      confidence: input.description ? 86 : schemaDescription ? 82 : 45,
      evidence: [
        input.description
          ? "Meta description"
          : schemaDescription
            ? "Structured data description"
            : "Visible page text",
      ],
    },
    category: {
      value: category,
      confidence: selectedCategory?.confidence || 0,
      evidence: selectedCategory
        ? [selectedCategory.evidence]
        : ["No reliable business context found"],
    },
    offerings: {
      value: offerings,
      confidence: visibleOfferings.length
        ? 76
        : schemaOfferings.length
          ? 60
          : 0,
      evidence: visibleOfferings.length
        ? ["Visible product/service navigation or cards"]
        : schemaOfferings.length
          ? ["Visible offering corroborated by structured data"]
          : ["No reliable offerings found"],
    },
    languages: {
      value: languages,
      confidence: input.htmlLang ? 92 : 58,
      evidence: [
        input.htmlLang
          ? "HTML lang and hreflang"
          : "Visible-script detection and hreflang",
      ],
    },
    markets: {
      value: markets,
      confidence: schemaMarkets.length ? 86 : inferredCountry ? 68 : 30,
      evidence: [
        schemaMarkets.length
          ? "Structured geographic data"
          : inferredCountry
            ? "Country-code domain"
            : "No specific market found",
      ],
    },
    intents: {
      value: ["discovery", "comparison", "recommendation", "alternatives"],
      confidence: 75,
      evidence: ["Offer and category-derived commercial intent framework"],
    },
    competitors: {
      value: competitors,
      confidence: competitors.length ? 66 : 20,
      evidence: [
        competitors.length
          ? "Explicit comparison or alternative language"
          : "No explicit competitors found before engine runs",
      ],
    },
    sourceUrl: input.sourceUrl,
  };
}

export function businessContextForVisibility(
  context: DiscoveredSiteContext,
): string {
  const candidates = [
    ...(context.offerings.confidence >= 60 ? context.offerings.value : []),
    ...(context.category.confidence >= 60 ? [context.category.value] : []),
  ];
  return (
    candidates.find((value) => isBusinessContextCandidate(value))?.trim() || ""
  );
}

function isArabic(language: string) {
  return language.toLowerCase().startsWith("ar");
}

export function generateIntentPrompts(
  context: DiscoveredSiteContext,
): IntentPrompt[] {
  const language = context.languages.value[0] || "en";
  const country = context.markets.value[0] || "Global";
  const businessContext = businessContextForVisibility(context);
  if (!businessContext) return [];
  const subject = clip(businessContext, 110);
  const questions = isArabic(language)
    ? [
        ["discovery", `ما الشركات التي تقدم ${subject} في سوق ${country}؟`],
        [
          "comparison",
          `قارن بين أبرز خيارات ${subject} المتاحة في سوق ${country}.`,
        ],
        [
          "recommendation",
          `ما أفضل خيارات ${subject} التي توصي بها لعميل يبحث عن حل موثوق في سوق ${country}؟`,
        ],
        [
          "alternatives",
          `ما البدائل الرائدة عند اختيار ${subject} في سوق ${country}، وما الفروق الرئيسية بينها؟`,
        ],
      ]
    : [
        [
          "discovery",
          `Which companies provide ${subject} in the ${country} market?`,
        ],
        [
          "comparison",
          `Compare the leading ${subject} options available in the ${country} market.`,
        ],
        [
          "recommendation",
          `What are the best ${subject} options you would recommend to a buyer seeking a reliable solution in the ${country} market?`,
        ],
        [
          "alternatives",
          `What are the leading alternatives when selecting ${subject} in the ${country} market, and what are their main differences?`,
        ],
      ];
  return questions.map(([intent, question], index) => ({
    id: `prompt_${index + 1}`,
    intent: intent as IntentPrompt["intent"],
    question,
    language,
    country,
  }));
}

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function brandAliases(brand: string, sourceUrl: string) {
  let hostAlias = "";
  try {
    hostAlias = new URL(sourceUrl).hostname
      .replace(/^www\./, "")
      .split(".")[0]
      .replace(/[-_]+/g, " ");
  } catch {
    /* A person or topic need not own a website. */
  }
  return unique([brand, hostAlias]).filter((value) => value.length >= 2);
}

function countMentions(text: string, aliases: string[]) {
  return aliases.reduce(
    (total, alias) =>
      total +
      (text.match(
        new RegExp(
          `(^|[^\\p{L}\\p{N}])${escaped(alias)}(?=$|[^\\p{L}\\p{N}])`,
          "giu",
        ),
      )?.length || 0),
    0,
  );
}

function excerptAround(text: string, needle: string) {
  const index = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (index < 0) return clip(text, 240);
  return clip(
    text
      .slice(
        Math.max(0, index - 90),
        Math.min(text.length, index + needle.length + 150),
      )
      .replace(/\s+/g, " ")
      .trim(),
    280,
  );
}

function listPosition(text: string, aliases: string[]) {
  for (const line of text.split(/\r?\n/)) {
    if (
      !aliases.some((alias) =>
        line.toLocaleLowerCase().includes(alias.toLocaleLowerCase()),
      )
    )
      continue;
    const match = line.match(/^\s*(\d{1,2})[.)\-:]\s+/);
    if (match) return Number(match[1]);
  }
  return null;
}

function listedEntities(text: string, brand: string) {
  const candidates: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:\d{1,2}[.)]|[-*•])\s*(?:\*\*)?([\p{L}\p{N}][\p{L}\p{N}&'’ .-]{1,55}?)(?:\*\*)?\s*(?:[:—–-]|$)/u,
    );
    if (!match) continue;
    const candidate = match[1].trim();
    if (
      candidate.split(/\s+/).length <= 7 &&
      candidate.toLocaleLowerCase() !== brand.toLocaleLowerCase()
    )
      candidates.push(candidate);
  }
  return unique(candidates).slice(0, 12);
}

export function analyzeVisibilityResponse(input: {
  responseText: string | null;
  brand: string;
  sourceUrl: string;
  knownCompetitors: string[];
  citations: EngineCitation[];
  aliases?: string[];
}): VisibilityAnalysis {
  if (!input.responseText)
    return {
      brandDetected: input.brand,
      brandVisible: false,
      mentionCount: 0,
      recommendationStatus: "unavailable",
      recommendationPosition: null,
      competitorsMentioned: [],
      evidence: [],
    };
  const aliases = unique([
    ...brandAliases(input.brand, input.sourceUrl),
    ...(input.aliases || []),
  ]);
  const mentionCount = countMentions(input.responseText, aliases);
  const position = listPosition(input.responseText, aliases);
  const brandVisible = mentionCount > 0;
  const context = brandVisible
    ? excerptAround(
        input.responseText,
        aliases.find((alias) =>
          input
            .responseText!.toLocaleLowerCase()
            .includes(alias.toLocaleLowerCase()),
        ) || input.brand,
      )
    : "";
  const recommendationLanguage =
    /\b(?:recommend(?:ed|ation)?|best|top|leading|strong choice|consider|suitable)\b|(?:أوصي|موصى|أفضل|أبرز|رائد|خيار مناسب)/iu;
  const negative =
    /(?:\b(?:not|never|cannot|can't|unable|insufficient|avoid)\b|لا\s|ليس|غير موصى|لا أوصي|لا انصح|لا أنصح)/iu.test(
      context,
    );
  const recommendationStatus: VisibilityAnalysis["recommendationStatus"] =
    !brandVisible
      ? "absent"
      : recommendationLanguage.test(context) && !negative
        ? "recommended"
        : position !== null
          ? "listed"
          : "mentioned";
  const competitors = unique([
    ...input.knownCompetitors.filter(
      (name) => countMentions(input.responseText!, [name]) > 0,
    ),
    ...listedEntities(input.responseText, input.brand),
  ]).filter(
    (name) =>
      !aliases.some(
        (alias) => name.toLocaleLowerCase() === alias.toLocaleLowerCase(),
      ),
  );
  const evidence: VisibilityEvidence[] = [];
  if (brandVisible)
    evidence.push({
      id: createId("evidence"),
      type: "brand_mention",
      entityName: input.brand,
      excerpt: context,
      position: null,
      sourceUrl: null,
      metadata: { mentionCount },
    });
  if (recommendationStatus === "recommended")
    evidence.push({
      id: createId("evidence"),
      type: "recommendation",
      entityName: input.brand,
      excerpt: context,
      position,
      sourceUrl: null,
      metadata: {},
    });
  if (position !== null)
    evidence.push({
      id: createId("evidence"),
      type: "list_position",
      entityName: input.brand,
      excerpt: context,
      position,
      sourceUrl: null,
      metadata: {},
    });
  for (const competitor of competitors)
    evidence.push({
      id: createId("evidence"),
      type: "competitor_mention",
      entityName: competitor,
      excerpt: excerptAround(input.responseText, competitor),
      position: listPosition(input.responseText, [competitor]),
      sourceUrl: null,
      metadata: {},
    });
  for (const citation of input.citations)
    evidence.push({
      id: createId("evidence"),
      type: "citation",
      entityName: null,
      excerpt: citation.title || citation.url,
      position: null,
      sourceUrl: citation.url,
      metadata: {
        startIndex: citation.startIndex,
        endIndex: citation.endIndex,
      },
    });
  return {
    brandDetected: input.brand,
    brandVisible,
    mentionCount,
    recommendationStatus,
    recommendationPosition: position,
    competitorsMentioned: competitors,
    evidence,
  };
}

export function aggregateActualVisibility(
  runs: VisibilityEngineRun[],
  promptCount: number,
): Omit<ActualVisibilityMeasurement, "engineRuns" | "prompts"> {
  const eligible = runs.filter(
    (run) => !["identity", "topic", "entity_resolution"].includes(run.intent),
  );
  const successful = eligible.filter(
    (run) =>
      !run.error && run.responseText && run.surfaceType === "api_with_search",
  );
  if (!eligible.length && runs.some((run) => !run.error && run.responseText))
    return { status: "partial", score: null, confidence: 0 };
  if (!successful.length)
    return {
      status: runs.some((run) => run.error?.code === "not_configured")
        ? "not_configured"
        : "failed",
      score: null,
      confidence: 0,
    };
  const mentionRate =
    successful.filter((run) => run.analysis.brandVisible).length /
    successful.length;
  // v1 reports an inspectable sample mention rate, not a calibrated recommendation probability.
  const expected = Math.max(
    eligible.length,
    promptCount -
      runs.filter((run) =>
        ["identity", "topic", "entity_resolution"].includes(run.intent),
      ).length,
  );
  return {
    status: successful.length === expected ? "measured" : "partial",
    score: Math.round(mentionRate * 100),
    confidence: Math.round((successful.length / Math.max(1, expected)) * 100),
  };
}

export async function runActualVisibility(input: {
  adapter: EngineAdapter;
  context: DiscoveredSiteContext;
  prompts?: IntentPrompt[];
  aliases?: string[];
  useDomainAlias?: boolean;
}): Promise<ActualVisibilityMeasurement> {
  const prompts = input.prompts || generateIntentPrompts(input.context);
  const engineRuns: VisibilityEngineRun[] = [];
  for (const prompt of prompts) {
    let response: EngineResponse;
    const started = Date.now();
    try {
      response = await input.adapter.run({
        prompt: prompt.question,
        language: prompt.language,
        country: prompt.country,
        useSearch: true,
      });
      response = {
        ...response,
        responseText: response.responseText
          ? sanitizeProviderAnswer(response.responseText, {
              decodeEntities: true,
            }) || null
          : null,
      };
    } catch (error) {
      response = {
        provider: input.adapter.provider,
        model: input.adapter.model,
        surfaceType: "api_with_search",
        responseText: null,
        sources: [],
        citations: [],
        usage: {
          inputTokens: null,
          cachedInputTokens: null,
          outputTokens: null,
          totalTokens: null,
        },
        estimatedCostMicros: null,
        durationMs: Date.now() - started,
        retryCount: 0,
        providerRunId: null,
        timestamp: new Date().toISOString(),
        error: {
          code: "adapter_error",
          message:
            error instanceof Error
              ? error.message.slice(0, 500)
              : "The engine adapter failed.",
          status: null,
          retryable: false,
        },
      };
    }
    const analysis = analyzeVisibilityResponse({
      responseText: response.responseText,
      brand: input.context.brand.value,
      sourceUrl: input.useDomainAlias === false ? "" : input.context.sourceUrl,
      knownCompetitors: input.context.competitors.value,
      citations: response.citations,
      aliases: input.aliases,
    });
    if (["identity", "topic", "entity_resolution"].includes(prompt.intent)) {
      analysis.recommendationStatus = "unavailable";
      analysis.recommendationPosition = null;
      analysis.evidence = analysis.evidence.filter(
        (item) =>
          item.type !== "recommendation" && item.type !== "list_position",
      );
    }
    engineRuns.push({
      id: createId("run"),
      provider: response.provider,
      model: response.model,
      surfaceType: response.surfaceType,
      promptId: prompt.id,
      intent: prompt.intent,
      prompt: prompt.question,
      language: prompt.language,
      country: prompt.country,
      responseText: response.responseText,
      sources: response.sources,
      citations: response.citations,
      analysis,
      usage: response.usage,
      estimatedCostMicros: response.estimatedCostMicros,
      durationMs: response.durationMs,
      error: response.error,
      retryCount: response.retryCount,
      timestamp: response.timestamp,
      providerRunId: response.providerRunId,
    });
  }
  const aggregate = aggregateActualVisibility(engineRuns, prompts.length);
  if (prompts.length && prompts.every((prompt) => prompt.intent === "topic")) {
    const successful = engineRuns.filter(
      (run) =>
        !run.error && run.responseText && run.surfaceType === "api_with_search",
    ).length;
    return {
      status:
        successful === prompts.length
          ? "measured"
          : successful
            ? "partial"
            : "failed",
      score: null,
      confidence: 0,
      engineRuns,
      prompts,
    };
  }
  return { ...aggregate, engineRuns, prompts };
}
