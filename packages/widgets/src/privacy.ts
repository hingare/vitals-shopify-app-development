type CustomerPrivacy = NonNullable<NonNullable<Window["Shopify"]>["customerPrivacy"]>;

/** Shopify-র Customer Privacy API (ক্রেতার কুকি সম্মতি); না পাওয়া গেলে null */
export function loadPrivacyApi(): Promise<CustomerPrivacy | null> {
  return new Promise((resolve) => {
    const shopify = window.Shopify;
    if (shopify?.customerPrivacy) return resolve(shopify.customerPrivacy);
    if (!shopify?.loadFeatures) return resolve(null);
    shopify.loadFeatures([{ name: "consent-tracking-api", version: "0.1" }], (error) =>
      resolve(error ? null : (window.Shopify?.customerPrivacy ?? null)),
    );
  });
}
