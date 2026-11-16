import { brand } from "@app/brand";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LogoMark } from "./Icon";
import { InstallButton } from "./InstallButton";
import { MobileMenu } from "./MobileMenu";

export const NAV_ITEMS = ["tools", "features", "pricing", "compare", "help", "blog"] as const;

export async function Header() {
  const t = await getTranslations("nav");
  const items = NAV_ITEMS.map((key) => ({ href: `/${key}`, label: t(key) }));
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" className="logo" aria-label={`${brand.name}, ${t("home")}`}>
          <LogoMark />
          <span>{brand.name}</span>
        </Link>
        <nav className="nav" aria-label="Main">
          {items.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="header-cta">
          <InstallButton />
        </div>
        <MobileMenu label={t("menu")} items={items} />
      </div>
    </header>
  );
}
