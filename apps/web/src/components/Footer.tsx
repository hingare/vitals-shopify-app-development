import { brand } from "@app/brand";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LogoMark } from "./Icon";

export async function Footer() {
  const t = await getTranslations("footer");
  const nav = await getTranslations("nav");
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link href="/" className="logo">
              <LogoMark />
              <span>{brand.name}</span>
            </Link>
            <p className="muted" style={{ marginTop: 12, maxWidth: 320 }}>
              {brand.tagline}
            </p>
          </div>
          <div>
            <h2>{t("product")}</h2>
            <ul>
              <li>
                <Link href="/tools">{nav("tools")}</Link>
              </li>
              <li>
                <Link href="/features">{nav("features")}</Link>
              </li>
              <li>
                <Link href="/pricing">{nav("pricing")}</Link>
              </li>
              <li>
                <Link href="/compare">{nav("compare")}</Link>
              </li>
            </ul>
          </div>
          <div>
            <h2>{t("resources")}</h2>
            <ul>
              <li>
                <Link href="/help">{nav("help")}</Link>
              </li>
              <li>
                <Link href="/help/getting-started">{t("gettingStarted")}</Link>
              </li>
              <li>
                <Link href="/blog">{nav("blog")}</Link>
              </li>
              <li>
                <a href="/llms.txt">{t("llms")}</a>
              </li>
            </ul>
          </div>
          <div>
            <h2>{t("company")}</h2>
            <ul>
              <li>
                <a href={`mailto:${brand.supportEmail}`}>{t("contact")}</a>
              </li>
              <li>
                <Link href="/privacy">{t("privacy")}</Link>
              </li>
              <li>
                <Link href="/terms">{t("terms")}</Link>
              </li>
            </ul>
          </div>
        </div>
        <p className="footer-bottom">
          {t("rights", { year, company: brand.legal.companyName })}
        </p>
      </div>
    </footer>
  );
}
