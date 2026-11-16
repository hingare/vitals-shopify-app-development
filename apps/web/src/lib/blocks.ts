import type { Block } from "@/content/help/types";

/** The questions and answers of every FAQ block, for FAQ structured data */
export function blockFaq(blocks: Block[]): Array<{ q: string; a: string }> {
  return blocks.flatMap((block) => (block.type === "faq" ? block.items : []));
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
