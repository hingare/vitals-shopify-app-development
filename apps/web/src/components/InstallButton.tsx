import { getTranslations } from "next-intl/server";
import { installHref, isListed } from "@/lib/site";

/** "Add to Shopify" once the App Store listing exists; until then an email to join the beta. */
export async function InstallButton({
  variant = "primary",
}: {
  variant?: "primary" | "secondary";
}) {
  const t = await getTranslations("nav");
  return (
    <a className={`btn btn-${variant}`} href={installHref()}>
      {isListed() ? t("install") : t("beta")}
    </a>
  );
}
