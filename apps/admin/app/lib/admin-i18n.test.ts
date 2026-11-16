import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { translate } from "@app/i18n";

/** app ফোল্ডারের সব .ts/.tsx ফাইল (টেস্ট বাদে) */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/**
 * কোডে সরাসরি লেখা t("...") key-গুলোর ইংরেজি লেখা আছে কিনা। না থাকলে মার্চেন্ট অ্যাডমিনে
 * লেখার বদলে key দেখত (যেমন "common.cancel")। `${...}` দিয়ে বানানো key এখানে ধরা পড়ে না।
 */
describe("admin translations", () => {
  it("has English text for every key the admin uses by name", () => {
    const missing = new Set<string>();
    for (const file of sourceFiles(join(__dirname, ".."))) {
      for (const match of readFileSync(file, "utf8").matchAll(/\bt\(\s*"([^"\\]+)"/g)) {
        const key = match[1] as string;
        if (translate("en", key) === key) missing.add(key);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });
});
