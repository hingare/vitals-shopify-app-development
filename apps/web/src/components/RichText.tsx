import { Fragment, type ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { INLINE_TOKEN } from "@/lib/text";

/**
 * Renders the tiny markup used in site content: **bold**, [text](link) and `code`, and a link inside
 * bold. Content is written by us, so this is formatting, not a security boundary; still, only
 * http(s), mailto and site paths link.
 */

export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE_TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    if (match[1] !== undefined) {
      out.push(<strong key={key++}>{renderInline(match[1])}</strong>);
    } else if (match[4] !== undefined) {
      out.push(<code key={key++}>{match[4]}</code>);
    } else if (match[2] !== undefined && match[3] !== undefined) {
      const href = match[3];
      if (href.startsWith("/")) {
        out.push(
          <Link key={key++} href={href}>
            {match[2]}
          </Link>,
        );
      } else if (/^(https?:|mailto:)/.test(href)) {
        out.push(
          <a key={key++} href={href} rel="noopener">
            {match[2]}
          </a>,
        );
      } else {
        out.push(match[2]);
      }
    }
    last = index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Inline({ text }: { text: string }) {
  return <Fragment>{renderInline(text)}</Fragment>;
}
