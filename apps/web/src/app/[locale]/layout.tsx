import type { Metadata, Viewport } from "next";
import { brand } from "@app/brand";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Analytics } from "@/components/Analytics";
import { ChatLauncher } from "@/components/ChatLauncher";
import type { ChatTexts } from "@/components/ChatPanel";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { JsonLd } from "@/components/JsonLd";
import { routing } from "@/i18n/routing";
import { toolIds } from "@/lib/catalog";
import { MAX_QUESTION_CHARS } from "@/lib/chat-limits";
import { organizationSchema, websiteSchema } from "@/lib/schema";
import { OG_IMAGE } from "@/lib/seo";
import { absoluteUrl, SITE_URL, supportChatEnabled } from "@/lib/site";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1020" },
  ],
};

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  const google = process.env.GOOGLE_SITE_VERIFICATION?.trim();
  const bing = process.env.BING_SITE_VERIFICATION?.trim();
  return {
    metadataBase: new URL(`${SITE_URL}/`),
    title: { default: `${brand.name}: ${brand.tagline}`, template: `%s | ${brand.name}` },
    description: t("description", { count: toolIds().length }),
    applicationName: brand.name,
    openGraph: {
      siteName: brand.name,
      type: "website",
      images: [{ ...OG_IMAGE, alt: brand.name }],
    },
    twitter: { card: "summary_large_image", images: [OG_IMAGE.url] },
    alternates: { types: { "text/plain": absoluteUrl("/llms.txt") } },
    verification: {
      ...(google ? { google } : {}),
      ...(bing ? { other: { "msvalidate.01": bing } } : {}),
    },
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "nav" });
  return (
    <html lang={locale}>
      <body>
        <a className="skip" href="#main">
          {t("skip")}
        </a>
        {/* Client components get their texts as props, so no messages are sent to the browser */}
        <NextIntlClientProvider messages={null}>
          <Header />
          <main id="main">{children}</main>
          <Footer />
          {supportChatEnabled() && <ChatLauncher texts={await chatTexts(locale)} />}
        </NextIntlClientProvider>
        <JsonLd data={[organizationSchema(), websiteSchema(locale)]} />
        <Analytics />
      </body>
    </html>
  );
}

/** The support assistant's texts, with the support email as a link */
async function chatTexts(locale: string): Promise<ChatTexts> {
  const t = await getTranslations({ locale, namespace: "chat" });
  const email = `[${brand.supportEmail}](mailto:${brand.supportEmail})`;
  return {
    open: t("open"),
    title: t("title"),
    close: t("close"),
    intro: t("intro"),
    placeholder: t("placeholder"),
    send: t("send"),
    thinking: t("thinking"),
    disclaimer: t("disclaimer", { email }),
    error: t("error", { email }),
    busy: t("busy", { email }),
    unavailable: t("unavailable", { email }),
    tooLong: t("tooLong", { max: MAX_QUESTION_CHARS }),
  };
}
