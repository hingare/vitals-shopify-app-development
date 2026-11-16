import { describe, expect, it } from "vitest";
import { isAllowed, parseRobots } from "./robots";

/** Shopify-র নিজের robots.txt-এর একটা অংশ */
const SHOPIFY_DEFAULT = `# we use Shopify as our ecommerce platform

User-agent: *
Disallow: /admin
Disallow: /cart
Disallow: /checkouts/
Disallow: /collections/*sort_by*
Disallow: /search
Allow: /search/
Disallow: /search/?*
Disallow: /policies/
Disallow: /products/*-remote
Sitemap: https://shop.example/sitemap.xml

# Google adsbot ignores robots.txt unless specifically named!
User-agent: adsbot-google
Disallow: /checkouts/
Disallow: /cart

User-agent: Nutch
Disallow: /

User-agent: MJ12bot
Crawl-Delay: 10

User-agent: Pinterest
Crawl-delay: 1
`;

describe("robots.txt", () => {
  it("lets AI crawlers read products on a store with Shopify's own file", () => {
    for (const bot of ["GPTBot", "OAI-SearchBot", "ClaudeBot", "PerplexityBot"]) {
      expect(isAllowed(SHOPIFY_DEFAULT, bot, "/")).toBe(true);
      expect(isAllowed(SHOPIFY_DEFAULT, bot, "/products/linen-shirt")).toBe(true);
      expect(isAllowed(SHOPIFY_DEFAULT, bot, "/cart")).toBe(false);
    }
    expect(isAllowed(SHOPIFY_DEFAULT, "GPTBot", "/collections/all?sort_by=price")).toBe(false);
    expect(isAllowed(SHOPIFY_DEFAULT, "GPTBot", "/products/shirt-remote")).toBe(false);
    expect(isAllowed(SHOPIFY_DEFAULT, "Nutch", "/products/linen-shirt")).toBe(false);
  });

  it("uses only a crawler's own group when it has one", () => {
    // MJ12bot-এর নিজের গ্রুপে কোনো নিষেধ নেই, তাই "*"-এর নিষেধও তার জন্য নয়
    expect(isAllowed(SHOPIFY_DEFAULT, "MJ12bot", "/cart")).toBe(true);
    const robots = "User-agent: *\nDisallow: /cart\n\nUser-agent: GPTBot\nDisallow: /\n";
    expect(isAllowed(robots, "GPTBot", "/products/a")).toBe(false);
    expect(isAllowed(robots, "ClaudeBot", "/products/a")).toBe(true);
  });

  it("reads several crawlers sharing one group, in any letter case and with versions", () => {
    const robots = "user-agent: gptbot/1.1\nUser-Agent: ClaudeBot\ndisallow: /\n";
    expect(isAllowed(robots, "GPTBot", "/")).toBe(false);
    expect(isAllowed(robots, "claudebot", "/")).toBe(false);
    expect(isAllowed(robots, "PerplexityBot", "/")).toBe(true);
  });

  it("joins groups written twice for the same crawler", () => {
    const robots = "User-agent: GPTBot\nDisallow: /a\n\nUser-agent: GPTBot\nDisallow: /b\n";
    expect(isAllowed(robots, "GPTBot", "/a")).toBe(false);
    expect(isAllowed(robots, "GPTBot", "/b")).toBe(false);
    expect(isAllowed(robots, "GPTBot", "/c")).toBe(true);
  });

  it("follows the most specific rule, and Allow on a tie", () => {
    const robots =
      "User-agent: *\nDisallow: /\nAllow: /products/\nDisallow: /products\nAllow: /products\n";
    expect(isAllowed(robots, "GPTBot", "/")).toBe(false);
    expect(isAllowed(robots, "GPTBot", "/pages/about")).toBe(false);
    expect(isAllowed(robots, "GPTBot", "/products/shirt")).toBe(true);
    expect(isAllowed(robots, "GPTBot", "/products")).toBe(true);
  });

  it("understands * and $ in paths", () => {
    const robots = "User-agent: *\nDisallow: /*.json$\nDisallow: /*?variant=\n";
    expect(isAllowed(robots, "GPTBot", "/products/a.json")).toBe(false);
    expect(isAllowed(robots, "GPTBot", "/products/a.jsonl")).toBe(true);
    expect(isAllowed(robots, "GPTBot", "/products/a?variant=1")).toBe(false);
    expect(isAllowed(robots, "GPTBot", "/products/a")).toBe(true);
  });

  it("treats an empty Disallow, comments and stray lines as allowing everything", () => {
    const robots = "# nothing blocked\nUser-agent: *\nDisallow:\nnonsense line\nSitemap: /x.xml\n";
    expect(isAllowed(robots, "GPTBot", "/")).toBe(true);
    expect(isAllowed("", "GPTBot", "/")).toBe(true);
    expect(parseRobots(robots)).toEqual([{ agents: ["*"], rules: [] }]);
  });
});
