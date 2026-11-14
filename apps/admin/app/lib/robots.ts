/**
 * robots.txt পড়া (RFC 9309, Google যেভাবে পড়ে): কোন ক্রলার কোন পাতায় ঢুকতে পারে।
 * - ক্রলারের নিজের নামের গ্রুপ থাকলে শুধু সেটা মানে, না থাকলে "*" গ্রুপ; একই নামের কয়েকটা গ্রুপ একসাথে ধরা হয়
 * - সবচেয়ে লম্বা (নির্দিষ্ট) মিলটা জেতে; Allow আর Disallow সমান লম্বা হলে Allow
 * - "*" যেকোনো লেখা, শেষে "$" মানে পথ ওখানেই শেষ
 * কোনো নিয়ম না মিললে ঢোকা যায়।
 */
export interface RobotsGroup {
  agents: string[];
  rules: Array<{ allow: boolean; pattern: string }>;
}

/** "GPTBot/1.1" বা " gptbot " → "gptbot" */
const productToken = (value: string) => (value.trim().split(/[\s/]/)[0] ?? "").toLowerCase();

export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  // পরপর কয়েকটা User-agent লাইন একই গ্রুপের
  let collectingAgents = false;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!current || !collectingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      const token = productToken(value);
      if (token) current.agents.push(token);
      collectingAgents = true;
      continue;
    }
    collectingAgents = false;
    if ((key === "allow" || key === "disallow") && current && value) {
      current.rules.push({ allow: key === "allow", pattern: value });
    }
  }
  return groups;
}

function matcher(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** এই ক্রলার (যেমন "GPTBot") এই পথে (যেমন "/products/shirt") ঢুকতে পারে কিনা */
export function isAllowed(robots: string | RobotsGroup[], crawler: string, path: string): boolean {
  const groups = typeof robots === "string" ? parseRobots(robots) : robots;
  const token = productToken(crawler);
  const own = groups.filter((group) => group.agents.includes(token));
  const chosen = own.length > 0 ? own : groups.filter((group) => group.agents.includes("*"));
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of chosen.flatMap((group) => group.rules)) {
    if (!matcher(rule.pattern).test(path)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow && !best.allow)) {
      best = { allow: rule.allow, length };
    }
  }
  return best?.allow ?? true;
}
