import type { Plan } from "@app/tool-sdk";
import { getTranslations } from "next-intl/server";

export async function PlanBadge({ plan }: { plan: Plan }) {
  const t = await getTranslations("common");
  return (
    <span className={`badge ${plan === "professional" ? "badge-pro" : "badge-starter"}`}>
      {t(`planBadge.${plan}`)}
    </span>
  );
}
