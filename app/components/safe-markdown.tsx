import { Fragment, type ReactNode } from "react";
import { safeSourceUrl } from "@/lib/analysis-target";
import { normalizeDisplayText } from "@/lib/answer-text";

function inline(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*|__)(.+?)\1|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(?<!\*)\*([^*\n]+)\*(?!\*)|_([^_\n]+)_/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    if (match.index > cursor)
      nodes.push(value.slice(cursor, match.index).replace(/\*\*|__/g, ""));
    if (match[2]) nodes.push(<strong key={match.index}>{match[2]}</strong>);
    else if (match[3])
      nodes.push(
        <code key={match.index} className="rounded bg-slate-200 px-1 py-0.5">
          {match[3]}
        </code>,
      );
    else if (match[4]) {
      const url = safeSourceUrl(match[5]);
      nodes.push(
        url ? (
          <a
            key={match.index}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-blue-700 underline"
          >
            {match[4]}
          </a>
        ) : (
          <Fragment key={match.index}>{match[4]}</Fragment>
        ),
      );
    } else
      nodes.push(
        <em key={match.index}>{match[6] || match[7]}</em>,
      );
    cursor = pattern.lastIndex;
  }
  if (cursor < value.length)
    nodes.push(value.slice(cursor).replace(/\*\*|__/g, ""));
  return nodes;
}

export function SafeMarkdown({ text }: { text: string | null }) {
  const clean = normalizeDisplayText(text || "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .trim();
  if (!clean) return null;
  return (
    <div dir="auto" className="space-y-2">
      {clean.split("\n").map((raw, index) => {
        const line = raw.trim();
        if (!line) return <div key={index} className="h-1" aria-hidden />;
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading)
          return (
            <p key={index} className="font-extrabold text-slate-900">
              {inline(heading[2])}
            </p>
          );
        const bullet = line.match(/^[-*+]\s+(.+)$/);
        if (bullet)
          return (
            <div key={index} className="flex gap-2 ps-2">
              <span aria-hidden>•</span>
              <p>{inline(bullet[1])}</p>
            </div>
          );
        const ordered = line.match(/^(\d+)[.)]\s+(.+)$/);
        if (ordered)
          return (
            <div key={index} className="flex gap-2 ps-2">
              <span className="font-semibold">{ordered[1]}.</span>
              <p>{inline(ordered[2])}</p>
            </div>
          );
        const quote = line.match(/^>\s?(.+)$/);
        if (quote)
          return (
            <blockquote key={index} className="border-s-2 border-slate-300 ps-3 text-slate-600">
              {inline(quote[1])}
            </blockquote>
          );
        return <p key={index}>{inline(line.replace(/^#{1,6}\s*/, ""))}</p>;
      })}
    </div>
  );
}
