// Shopify CLI-র মতো: এই ফাইলের target-এর API আর কম্পোনেন্টের টাইপ
import "@shopify/ui-extensions";

declare module "./src/Checkout.tsx" {
  const shopify: import("@shopify/ui-extensions/purchase.checkout.cart-line-list.render-after").Api;
  const globalThis: { shopify: typeof shopify };
}
