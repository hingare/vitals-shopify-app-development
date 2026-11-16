"use client";

import { useMemo, useState } from "react";
import { Link } from "@/i18n/navigation";

export interface SearchItem {
  title: string;
  description: string;
  href: string;
  /** Extra words that should find this article, like the tool's category */
  keywords: string;
}

const words = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** Every word typed must appear somewhere; title matches rank first. */
export function searchArticles(items: SearchItem[], query: string, limit = 8): SearchItem[] {
  const terms = words(query);
  if (terms.length === 0) return [];
  const scored: Array<{ item: SearchItem; score: number }> = [];
  for (const item of items) {
    const title = words(item.title);
    const rest = words(`${item.description} ${item.keywords}`);
    let score = 0;
    for (const term of terms) {
      if (title.some((w) => w.startsWith(term))) score += 3;
      else if (rest.some((w) => w.startsWith(term))) score += 1;
      else {
        score = -1;
        break;
      }
    }
    if (score > 0) scored.push({ item, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
    .slice(0, limit)
    .map(({ item }) => item);
}

export function HelpSearch({
  items,
  label,
  empty,
}: {
  items: SearchItem[];
  label: string;
  empty: string;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchArticles(items, query), [items, query]);
  return (
    <div role="search">
      <label className="sr-only" htmlFor="help-search">
        {label}
      </label>
      <input
        id="help-search"
        className="search-box"
        type="search"
        placeholder={label}
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query.trim() !== "" && (
        <div aria-live="polite">
          {results.length === 0 ? (
            <p className="muted" style={{ marginTop: 16 }}>
              {empty}
            </p>
          ) : (
            <ul className="search-results">
              {results.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>
                    {item.title}
                    <small>{item.description}</small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
