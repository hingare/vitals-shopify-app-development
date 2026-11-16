import { Link } from "@/i18n/navigation";
import type { CatalogTool } from "@/lib/catalog";
import { PlanBadge } from "./PlanBadge";

export function ToolCard({ tool, headingLevel = 3 }: { tool: CatalogTool; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <Link href={`/tools/${tool.id}`} className="card card-link tool-card">
      <div className="tool-card-top">
        <Heading>{tool.name}</Heading>
        <PlanBadge plan={tool.plan} />
      </div>
      <p>{tool.description}</p>
    </Link>
  );
}
