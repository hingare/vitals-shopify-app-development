import { llmsFullText } from "@/lib/llms";

export const dynamic = "force-static";

/** Every help article in one file, for AI assistants */
export async function GET() {
  return new Response(await llmsFullText(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
