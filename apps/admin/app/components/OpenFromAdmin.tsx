import { brand } from "@app/brand";
import { createT } from "@app/i18n";

import styles from "./OpenFromAdmin.module.css";

/**
 * অ্যাপের ঠিকানা Shopify অ্যাডমিনের বাইরে সরাসরি খুললে এই পাতা দেখায় (`/` আর `/auth/login`)।
 * দোকানের ঠিকানা লিখতে বলা হয় না: App Store-এর শর্ত ২.৩.১ অনুযায়ী ইনস্টল শুরু হয় শুধু Shopify-র নিজের
 * জায়গা থেকে (App Store বা অ্যাডমিন), তাই এখানে শুধু সেখানে যাওয়ার পথ দেখানো হয়।
 */
export function OpenFromAdmin({ error }: { error?: string }) {
  const t = createT("en");
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.heading}>{brand.name}</h1>
        <p className={styles.tagline}>{brand.tagline}</p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <p>{t("landing.body", { app: brand.name })}</p>
        <div className={styles.actions}>
          {brand.appStoreUrl && (
            <a className={styles.primary} href={brand.appStoreUrl}>
              {t("landing.appStore")}
            </a>
          )}
          <a
            className={brand.appStoreUrl ? styles.secondary : styles.primary}
            href="https://admin.shopify.com/"
          >
            {t("landing.admin")}
          </a>
        </div>
      </div>
    </main>
  );
}
