import { llmsText } from "@/lib/llms";

export const dynamic = "force-static";

/** A short map of the site for AI assistants (llmstxt.org) */
export async function GET() {
  return new Response(await llmsText(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
