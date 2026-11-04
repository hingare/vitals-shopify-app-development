import { createRegistry } from "@app/tool-sdk";
import { stickyAtc } from "./sticky-atc";

/** সব টুলের তালিকা। নতুন টুল বানালে এখানে যোগ করুন। */
export const registry = createRegistry([stickyAtc]);

export { buildStoreConfig } from "./config";
export type { SavedToolState, StoreToolConfig } from "./config";
