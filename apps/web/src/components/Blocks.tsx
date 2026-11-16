import type { Block } from "@/content/help/types";
import { Faq } from "./Faq";
import { Inline } from "./RichText";

/** An id for a heading, so sections of long articles can be linked to */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Renders the content blocks of guides, comparisons and blog posts. `fill` swaps `{name}`
 * placeholders for plan facts before the text is shown.
 */
export function Blocks({
  blocks,
  fill = (text) => text,
}: {
  blocks: Block[];
  fill?: (text: string) => string;
}) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.type) {
          case "p":
            return (
              <p key={index}>
                <Inline text={fill(block.text)} />
              </p>
            );
          case "h2":
            return (
              <h2 key={index} id={headingId(block.text)}>
                {fill(block.text)}
              </h2>
            );
          case "steps":
            return (
              <ol key={index} className="steps">
                {block.items.map((item, i) => (
                  <li key={i}>
                    <Inline text={fill(item)} />
                  </li>
                ))}
              </ol>
            );
          case "list":
            return (
              <ul key={index}>
                {block.items.map((item, i) => (
                  <li key={i}>
                    <Inline text={fill(item)} />
                  </li>
                ))}
              </ul>
            );
          case "note":
            return (
              <div key={index} className="callout">
                <p>
                  <Inline text={fill(block.text)} />
                </p>
              </div>
            );
          case "table":
            return (
              <div key={index} className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {block.headers.map((header, i) => (
                        <th key={i} scope="col">
                          {fill(header)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) =>
                          j === 0 ? (
                            <th key={j} scope="row">
                              <Inline text={fill(cell)} />
                            </th>
                          ) : (
                            <td key={j}>
                              <Inline text={fill(cell)} />
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "faq":
            return (
              <Faq
                key={index}
                items={block.items.map((item) => ({ q: fill(item.q), a: fill(item.a) }))}
              />
            );
        }
      })}
    </>
  );
}

/** Every piece of text in a list of blocks, for search, reading time and llms-full.txt */
export function blockTexts(blocks: Block[]): string[] {
  return blocks.flatMap((block) => {
    switch (block.type) {
      case "p":
      case "h2":
      case "note":
        return [block.text];
      case "steps":
      case "list":
        return block.items;
      case "faq":
        return block.items.flatMap((item) => [item.q, item.a]);
      case "table":
        return [...block.headers, ...block.rows.flat()];
    }
  });
}
