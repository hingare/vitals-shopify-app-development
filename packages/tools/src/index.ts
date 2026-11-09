import { createRegistry } from "@app/tool-sdk";
import { productReviews } from "./product-reviews";
import { stickyAtc } from "./sticky-atc";

/** সব টুলের তালিকা। নতুন টুল বানালে এখানে যোগ করুন। */
export const registry = createRegistry([stickyAtc, productReviews]);

export { buildStoreConfig } from "./config";
export type { SavedToolState, StoreToolConfig } from "./config";
export { productReviews } from "./product-reviews";
