import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Shopify-র theme app extension সীমা: সর্বোচ্চ ৩০ ব্লক, মোট Liquid ১০০KB, ব্লকের নাম ২৫ অক্ষর
const EXT = join(__dirname, "../../extensions/theme-embed");
const liquid = (dir: string) =>
  readdirSync(join(EXT, dir))
    .filter((f) => f.endsWith(".liquid"))
    .map((f) => join(EXT, dir, f));

describe("theme app extension limits", () => {
  const blocks = liquid("blocks");

  it("stays within 30 blocks", () => {
    expect(blocks.length).toBeLessThanOrEqual(30);
  });

  it("keeps all Liquid under 100KB", () => {
    const total = [...blocks, ...liquid("snippets")].reduce((sum, f) => sum + statSync(f).size, 0);
    expect(total).toBeLessThan(100 * 1024);
  });

  it("uses block names of 25 characters or less", () => {
    for (const file of blocks) {
      const schema = JSON.parse(
        readFileSync(file, "utf8").split("{% schema %}")[1]!.split("{% endschema %}")[0]!,
      );
      const name: string = schema.name;
      if (!name.startsWith("t:")) expect(name.length, file).toBeLessThanOrEqual(25);
      // CSS packages/widgets/public থেকে বিল্ডে assets-এ কপি হয়
      if (schema.stylesheet) {
        expect(
          statSync(
            join(__dirname, "../../../../packages/widgets/public", schema.stylesheet),
          ).isFile(),
        ).toBe(true);
      }
    }
  });
});
