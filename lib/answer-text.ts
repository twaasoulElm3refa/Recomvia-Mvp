const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "\u2026",
  laquo: "\u00ab",
  lt: "<",
  mdash: "\u2014",
  nbsp: " ",
  ndash: "\u2013",
  quot: '"',
  raquo: "\u00bb",
};

export function decodeHtmlEntities(value: string) {
  return value.replace(
    /&(?:#(\d{1,7})|#x([\da-f]{1,6})|([a-z][a-z\d]+));/gi,
    (entity, decimal: string, hexadecimal: string, named: string) => {
      if (decimal || hexadecimal) {
        const point = Number.parseInt(decimal || hexadecimal, decimal ? 10 : 16);
        if (
          Number.isFinite(point) &&
          point > 0 &&
          point <= 0x10ffff &&
          !(point >= 0xd800 && point <= 0xdfff)
        )
          return String.fromCodePoint(point);
        return entity;
      }
      return NAMED_ENTITIES[named.toLowerCase()] ?? entity;
    },
  );
}

const PLANNING_LINE =
  /^(?:the user (?:wants|asks|is asking|provided)|we need(?: to)?|i need(?: to)?|let me|let's|i(?:'ll| will) (?:search|browse|analy[sz]e|reason|plan|craft)|need (?:search|browse|answer|respond)|first,? (?:i|we) (?:need|will|should)|analysis\s*:)/i;

/**
 * Removes provider reasoning wrappers and obvious leading planning narration.
 * Citation metadata is deliberately handled separately by the adapter.
 */
export function sanitizeProviderAnswer(
  value: string,
  options: { decodeEntities?: boolean } = {},
) {
  let text = value.replace(/\r\n?/g, "\n").trim();

  // Qwen-style reasoning can arrive as a complete block, a closing tag only,
  // or a dangling opening block when the provider truncates the response.
  text = text.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, "\n");
  const closingThinkTags = [...text.matchAll(/<\/think\s*>/gi)];
  const lastClosingThink = closingThinkTags.at(-1);
  if (lastClosingThink?.index !== undefined)
    text = text.slice(lastClosingThink.index + lastClosingThink[0].length);
  const openingThink = text.search(/<think\b[^>]*>/i);
  if (openingThink >= 0) text = text.slice(0, openingThink);
  text = text.replace(/<\/?think\b[^>]*>/gi, "\n").trim();

  const lines = text.split("\n");
  while (lines.length) {
    const line = lines[0].trim().replace(/^[-*#>\s]+/, "");
    if (!line) {
      lines.shift();
      continue;
    }
    if (!PLANNING_LINE.test(line)) break;
    lines.shift();
  }
  text = lines
    .join("\n")
    .replace(/^\s*(?:final answer|answer)\s*:\s*/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return options.decodeEntities ? decodeHtmlEntities(text) : text;
}

export function normalizeDisplayText(value: string) {
  return sanitizeProviderAnswer(value, { decodeEntities: true });
}
