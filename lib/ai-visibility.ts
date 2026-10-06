import { createId } from "./ids";
import type { EngineAdapter, EngineCitation, EngineProviderError, EngineResponse, EngineSource, EngineSurfaceType, EngineUsage } from "./ai-engines/engine-adapter";

export type ConfidenceValue<T> = { value: T; confidence: number; evidence: string[] };

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
  intent: "discovery" | "comparison" | "recommendation" | "alternatives";
  question: string;
  language: string;
  country: string;
};

export type VisibilityEvidence = {
  id: string;
  type: "brand_mention" | "recommendation" | "list_position" | "competitor_mention" | "citation";
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
  recommendationStatus: "recommended" | "listed" | "mentioned" | "absent" | "unavailable";
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

type WebsiteContextInput = { sourceUrl: string; finalUrl: string; title: string; description: string; htmlLang: string; html: string; visibleText: string };

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.map(value => value.replace(/\s+/g, " ").trim()).filter(value => {
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clip(value: string, length = 260) { return value.length > length ? `${value.slice(0, length - 1)}…` : value; }

function jsonLdObjects(html: string): unknown[] {
  const objects: unknown[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      objects.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch { /* Invalid page markup is ignored during discovery. */ }
  }
  return objects;
}

function walkJson(value: unknown, visit: (object: Record<string, unknown>) => void) {
  if (Array.isArray(value)) return value.forEach(item => walkJson(item, visit));
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  visit(object);
  Object.values(object).forEach(item => walkJson(item, visit));
}

function schemaTypes(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(item => typeof item === "string") : typeof value === "string" ? [value] : [];
}

function hostnameBrand(url: string) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const first = host.split(".")[0].replace(/[-_]+/g, " ");
  return first.replace(/\b\w/g, character => character.toUpperCase());
}

function metaContent(html: string, key: string) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = tag.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (name !== key.toLowerCase()) continue;
    return tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1]?.trim() || "";
  }
  return "";
}

function anchorOfferings(html: string) {
  const values: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["'][^"']*\/(?:products?|services?|solutions?|platform|features?)(?:[\/?#"'][^"']*)?["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = match[1].replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
    if (text.length >= 3 && text.length <= 80 && !/^(products?|services?|solutions?|platform|features?|learn more)$/i.test(text)) values.push(text);
  }
  return unique(values).slice(0, 8);
}

function explicitCompetitors(text: string, brand: string) {
  const values: string[] = [];
  const escapedBrand = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const match of text.matchAll(new RegExp(`(?:${escapedBrand}\\s+vs\\.?|alternatives?\\s+to\\s+${escapedBrand}|compare\\s+${escapedBrand}\\s+(?:with|and))\\s+([\\p{L}\\p{N}][\\p{L}\\p{N} .&'-]{1,50})`, "giu"))) {
    values.push((match[1].split(/[|,.;:]/)[0] || "").trim());
  }
  return unique(values).filter(value => value.toLowerCase() !== brand.toLowerCase()).slice(0, 6);
}

function countryFromUrl(url: string) {
  const suffix = new URL(url).hostname.split(".").at(-1)?.toLowerCase();
  const countries: Record<string, string> = { ae: "United Arab Emirates", sa: "Saudi Arabia", eg: "Egypt", uk: "United Kingdom", de: "Germany", fr: "France", ca: "Canada", au: "Australia", in: "India" };
  return suffix ? countries[suffix] : undefined;
}

export function discoverWebsiteContext(input: WebsiteContextInput): DiscoveredSiteContext {
  const structured = jsonLdObjects(input.html);
  let organizationName = "";
  let schemaDescription = "";
  let schemaCategory = "";
  const schemaOfferings: string[] = [];
  const schemaMarkets: string[] = [];
  walkJson(structured, object => {
    const types = schemaTypes(object["@type"]);
    if (!organizationName && types.some(type => ["Organization", "Corporation", "LocalBusiness", "Brand"].includes(type)) && typeof object.name === "string") organizationName = object.name.trim();
    if (!schemaDescription && typeof object.description === "string") schemaDescription = object.description.trim();
    if (!schemaCategory) {
      const category = typeof object.category === "string" ? object.category : types.find(type => !["Organization", "WebSite", "WebPage", "BreadcrumbList", "FAQPage"].includes(type));
      if (category) schemaCategory = category;
    }
    if (["Product", "Service", "SoftwareApplication", "Offer"].some(type => types.includes(type)) && typeof object.name === "string") schemaOfferings.push(object.name);
    for (const field of [object.areaServed, object.addressCountry]) {
      if (typeof field === "string") schemaMarkets.push(field);
      else if (field && typeof field === "object" && typeof (field as Record<string, unknown>).name === "string") schemaMarkets.push((field as Record<string, unknown>).name as string);
    }
  });

  const siteName = metaContent(input.html, "og:site_name") || metaContent(input.html, "application-name");
  const titleCandidate = input.title.split(/\s+[|—–-]\s+/)[0]?.trim() || "";
  const brand = organizationName || siteName || titleCandidate || hostnameBrand(input.finalUrl);
  const description = input.description || schemaDescription || clip(input.visibleText, 260);
  const offerings = unique([...schemaOfferings, ...anchorOfferings(input.html)]);
  const alternateLanguages = [...input.html.matchAll(/hreflang\s*=\s*["']([^"']+)["']/gi)].map(match => match[1].split("-")[0]);
  const primaryLanguage = input.htmlLang.split("-")[0] || ((input.visibleText.match(/[\u0600-\u06ff]/g)?.length || 0) > input.visibleText.length * 0.12 ? "ar" : "en");
  const languages = unique([primaryLanguage, ...alternateLanguages.filter(value => value !== "x-default")]);
  const inferredCountry = countryFromUrl(input.finalUrl);
  const markets = unique([...schemaMarkets, ...(inferredCountry ? [inferredCountry] : ["Global"])]);
  const category = schemaCategory || offerings[0] || description.split(/[.!?،]/)[0]?.slice(0, 100) || "business services";
  const competitors = explicitCompetitors(input.visibleText, brand);

  return {
    brand: { value: brand, confidence: organizationName ? 94 : siteName ? 88 : titleCandidate ? 72 : 55, evidence: [organizationName ? "Organization structured data" : siteName ? "og:site_name" : titleCandidate ? "Page title" : "Hostname"] },
    description: { value: description, confidence: input.description ? 86 : schemaDescription ? 82 : 45, evidence: [input.description ? "Meta description" : schemaDescription ? "Structured data description" : "Visible page text"] },
    category: { value: category, confidence: schemaCategory ? 82 : offerings.length ? 68 : 42, evidence: [schemaCategory ? "Structured data type/category" : offerings.length ? "Detected offering" : "Description inference"] },
    offerings: { value: offerings, confidence: schemaOfferings.length ? 86 : offerings.length ? 65 : 25, evidence: schemaOfferings.length ? ["Product or Service structured data"] : offerings.length ? ["Product/service links"] : ["No explicit offerings found"] },
    languages: { value: languages, confidence: input.htmlLang ? 92 : 58, evidence: [input.htmlLang ? "HTML lang and hreflang" : "Visible-script detection and hreflang"] },
    markets: { value: markets, confidence: schemaMarkets.length ? 86 : inferredCountry ? 68 : 30, evidence: [schemaMarkets.length ? "Structured geographic data" : inferredCountry ? "Country-code domain" : "No specific market found"] },
    intents: { value: ["discovery", "comparison", "recommendation", "alternatives"], confidence: 75, evidence: ["Offer and category-derived commercial intent framework"] },
    competitors: { value: competitors, confidence: competitors.length ? 66 : 20, evidence: [competitors.length ? "Explicit comparison or alternative language" : "No explicit competitors found before engine runs"] },
    sourceUrl: input.sourceUrl,
  };
}

function isArabic(language: string) { return language.toLowerCase().startsWith("ar"); }

export function generateIntentPrompts(context: DiscoveredSiteContext): IntentPrompt[] {
  const language = context.languages.value[0] || "en";
  const country = context.markets.value[0] || "Global";
  const offering = context.offerings.value[0] || context.category.value || context.description.value.split(/[.!?،]/)[0];
  const subject = clip(offering, 110);
  const questions = isArabic(language) ? [
    ["discovery", `ما الشركات التي تقدم ${subject} في سوق ${country}؟`],
    ["comparison", `قارن بين أبرز خيارات ${subject} المتاحة في سوق ${country}.`],
    ["recommendation", `ما أفضل خيارات ${subject} التي توصي بها لعميل يبحث عن حل موثوق في سوق ${country}؟`],
    ["alternatives", `ما البدائل الرائدة عند اختيار ${subject} في سوق ${country}، وما الفروق الرئيسية بينها؟`],
  ] : [
    ["discovery", `Which companies provide ${subject} in the ${country} market?`],
    ["comparison", `Compare the leading ${subject} options available in the ${country} market.`],
    ["recommendation", `What are the best ${subject} options you would recommend to a buyer seeking a reliable solution in the ${country} market?`],
    ["alternatives", `What are the leading alternatives when selecting ${subject} in the ${country} market, and what are their main differences?`],
  ];
  return questions.map(([intent, question], index) => ({ id: `prompt_${index + 1}`, intent: intent as IntentPrompt["intent"], question, language, country }));
}

function escaped(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function brandAliases(brand: string, sourceUrl: string) {
  const hostAlias = new URL(sourceUrl).hostname.replace(/^www\./, "").split(".")[0].replace(/[-_]+/g, " ");
  return unique([brand, hostAlias]).filter(value => value.length >= 2);
}

function countMentions(text: string, aliases: string[]) {
  return aliases.reduce((total, alias) => total + (text.match(new RegExp(`(^|[^\\p{L}\\p{N}])${escaped(alias)}(?=$|[^\\p{L}\\p{N}])`, "giu"))?.length || 0), 0);
}

function excerptAround(text: string, needle: string) {
  const index = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (index < 0) return clip(text, 240);
  return clip(text.slice(Math.max(0, index - 90), Math.min(text.length, index + needle.length + 150)).replace(/\s+/g, " ").trim(), 280);
}

function listPosition(text: string, aliases: string[]) {
  for (const line of text.split(/\r?\n/)) {
    if (!aliases.some(alias => line.toLocaleLowerCase().includes(alias.toLocaleLowerCase()))) continue;
    const match = line.match(/^\s*(\d{1,2})[.)\-:]\s+/);
    if (match) return Number(match[1]);
  }
  return null;
}

function listedEntities(text: string, brand: string) {
  const candidates: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:\d{1,2}[.)]|[-*•])\s*(?:\*\*)?([\p{L}\p{N}][\p{L}\p{N}&'’ .-]{1,55}?)(?:\*\*)?\s*(?:[:—–-]|$)/u);
    if (!match) continue;
    const candidate = match[1].trim();
    if (candidate.split(/\s+/).length <= 7 && candidate.toLocaleLowerCase() !== brand.toLocaleLowerCase()) candidates.push(candidate);
  }
  return unique(candidates).slice(0, 12);
}

export function analyzeVisibilityResponse(input: { responseText: string | null; brand: string; sourceUrl: string; knownCompetitors: string[]; citations: EngineCitation[] }): VisibilityAnalysis {
  if (!input.responseText) return { brandDetected: input.brand, brandVisible: false, mentionCount: 0, recommendationStatus: "unavailable", recommendationPosition: null, competitorsMentioned: [], evidence: [] };
  const aliases = brandAliases(input.brand, input.sourceUrl);
  const mentionCount = countMentions(input.responseText, aliases);
  const position = listPosition(input.responseText, aliases);
  const brandVisible = mentionCount > 0;
  const context = brandVisible ? excerptAround(input.responseText, aliases.find(alias => input.responseText!.toLocaleLowerCase().includes(alias.toLocaleLowerCase())) || input.brand) : "";
  const recommendationLanguage = /\b(?:recommend(?:ed|ation)?|best|top|leading|strong choice|consider|suitable)\b|(?:أوصي|موصى|أفضل|أبرز|رائد|خيار مناسب)/iu;
  const recommendationStatus: VisibilityAnalysis["recommendationStatus"] = !brandVisible ? "absent" : recommendationLanguage.test(context) ? "recommended" : position !== null ? "listed" : "mentioned";
  const competitors = unique([...input.knownCompetitors.filter(name => countMentions(input.responseText!, [name]) > 0), ...listedEntities(input.responseText, input.brand)]).filter(name => !aliases.some(alias => name.toLocaleLowerCase() === alias.toLocaleLowerCase()));
  const evidence: VisibilityEvidence[] = [];
  if (brandVisible) evidence.push({ id: createId("evidence"), type: "brand_mention", entityName: input.brand, excerpt: context, position: null, sourceUrl: null, metadata: { mentionCount } });
  if (recommendationStatus === "recommended") evidence.push({ id: createId("evidence"), type: "recommendation", entityName: input.brand, excerpt: context, position, sourceUrl: null, metadata: {} });
  if (position !== null) evidence.push({ id: createId("evidence"), type: "list_position", entityName: input.brand, excerpt: context, position, sourceUrl: null, metadata: {} });
  for (const competitor of competitors) evidence.push({ id: createId("evidence"), type: "competitor_mention", entityName: competitor, excerpt: excerptAround(input.responseText, competitor), position: listPosition(input.responseText, [competitor]), sourceUrl: null, metadata: {} });
  for (const citation of input.citations) evidence.push({ id: createId("evidence"), type: "citation", entityName: null, excerpt: citation.title || citation.url, position: null, sourceUrl: citation.url, metadata: { startIndex: citation.startIndex, endIndex: citation.endIndex } });
  return { brandDetected: input.brand, brandVisible, mentionCount, recommendationStatus, recommendationPosition: position, competitorsMentioned: competitors, evidence };
}

export function aggregateActualVisibility(runs: VisibilityEngineRun[], promptCount: number): Omit<ActualVisibilityMeasurement, "engineRuns" | "prompts"> {
  const successful = runs.filter(run => !run.error && run.responseText);
  if (!successful.length) return { status: runs.some(run => run.error?.code === "not_configured") ? "not_configured" : "failed", score: null, confidence: 0 };
  const mentionRate = successful.filter(run => run.analysis.brandVisible).length / successful.length;
  const recommendationRate = successful.filter(run => run.analysis.recommendationStatus === "recommended").length / successful.length;
  const positioned = successful.filter(run => run.analysis.recommendationPosition !== null);
  const positionScore = positioned.length ? positioned.reduce((sum, run) => sum + Math.max(0, 1 - ((run.analysis.recommendationPosition || 1) - 1) / 9), 0) / successful.length : 0;
  const score = Math.round((mentionRate * 40) + (recommendationRate * 40) + (positionScore * 20));
  const coverage = successful.length / Math.max(1, promptCount);
  return { status: successful.length === promptCount ? "measured" : "partial", score, confidence: Math.round(Math.min(90, 45 + coverage * 35 + Math.min(successful.length, 4) * 2.5)) };
}

export async function runActualVisibility(input: { adapter: EngineAdapter; context: DiscoveredSiteContext; prompts?: IntentPrompt[] }): Promise<ActualVisibilityMeasurement> {
  const prompts = input.prompts || generateIntentPrompts(input.context);
  const engineRuns: VisibilityEngineRun[] = [];
  for (const prompt of prompts) {
    let response: EngineResponse;
    const started = Date.now();
    try {
      response = await input.adapter.run({ prompt: prompt.question, language: prompt.language, country: prompt.country, useSearch: true });
    } catch (error) {
      response = {
        provider: input.adapter.provider,
        model: input.adapter.model,
        surfaceType: "api_with_search",
        responseText: null,
        sources: [],
        citations: [],
        usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null, totalTokens: null },
        estimatedCostMicros: null,
        durationMs: Date.now() - started,
        retryCount: 0,
        providerRunId: null,
        timestamp: new Date().toISOString(),
        error: { code: "adapter_error", message: error instanceof Error ? error.message.slice(0, 500) : "The engine adapter failed.", status: null, retryable: false },
      };
    }
    const analysis = analyzeVisibilityResponse({ responseText: response.responseText, brand: input.context.brand.value, sourceUrl: input.context.sourceUrl, knownCompetitors: input.context.competitors.value, citations: response.citations });
    engineRuns.push({
      id: createId("run"), provider: response.provider, model: response.model, surfaceType: response.surfaceType,
      promptId: prompt.id, intent: prompt.intent, prompt: prompt.question, language: prompt.language, country: prompt.country,
      responseText: response.responseText, sources: response.sources, citations: response.citations, analysis, usage: response.usage,
      estimatedCostMicros: response.estimatedCostMicros, durationMs: response.durationMs, error: response.error,
      retryCount: response.retryCount, timestamp: response.timestamp, providerRunId: response.providerRunId,
    });
  }
  return { ...aggregateActualVisibility(engineRuns, prompts.length), engineRuns, prompts };
}
