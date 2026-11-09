import { createRegistry } from "@app/tool-sdk";
import {
  announcementBar,
  chatButton,
  countdownTimer,
  popup,
  spendingGoal,
  stockScarcity,
} from "./conversion";
import {
  acceleratedCheckout,
  bogo,
  bundles,
  cartDrawer,
  cartNotice,
  freeGifts,
  preOrders,
  upsells,
  volumeDiscounts,
} from "./offers";
import { productReviews } from "./product-reviews";
import { cookiesBanner, currencyConverter, geolocationRedirect } from "./shopify-alternatives";
import {
  animatedAtc,
  autoExternalLinks,
  contentProtection,
  faviconCartCount,
  inactiveTabMessage,
  scrollToTop,
  socialButtons,
} from "./small";
import { stickyAtc } from "./sticky-atc";
import {
  agreeToTerms,
  descriptionTabs,
  hideDynamicCheckout,
  productLabels,
  quickLinks,
  recentlyViewed,
  recentSales,
  relatedProducts,
  shippingInfo,
  sizeChart,
} from "./stage3";
import { paymentLogos, trustSeals } from "./trust";

/** সব টুলের তালিকা। নতুন টুল বানালে এখানে যোগ করুন। */
export const registry = createRegistry([
  stickyAtc,
  productReviews,
  volumeDiscounts,
  bundles,
  freeGifts,
  bogo,
  upsells,
  cartDrawer,
  cartNotice,
  acceleratedCheckout,
  preOrders,
  spendingGoal,
  trustSeals,
  paymentLogos,
  announcementBar,
  countdownTimer,
  stockScarcity,
  chatButton,
  popup,
  scrollToTop,
  inactiveTabMessage,
  contentProtection,
  animatedAtc,
  socialButtons,
  autoExternalLinks,
  faviconCartCount,
  shippingInfo,
  recentSales,
  productLabels,
  descriptionTabs,
  sizeChart,
  relatedProducts,
  recentlyViewed,
  quickLinks,
  hideDynamicCheckout,
  agreeToTerms,
  currencyConverter,
  cookiesBanner,
  geolocationRedirect,
]);

export { buildStoreConfig } from "./config";
export type { SavedToolState, StoreToolConfig } from "./config";
export { productReviews } from "./product-reviews";
export {
  acceleratedCheckout,
  bogo,
  bundles,
  cartDrawer,
  cartNotice,
  freeGifts,
  OFFER_TOOL_BY_TYPE,
  preOrders,
  upsells,
  volumeDiscounts,
} from "./offers";
export { CHAT_CHANNELS } from "./conversion";
export { TRUST_BADGES } from "./trust";
export { SHARE_NETWORKS } from "./small";
export { recentSales } from "./stage3";
export { CURRENCIES } from "./shopify-alternatives";
