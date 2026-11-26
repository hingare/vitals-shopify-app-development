import type { ToolContext } from "../types";
import { type TermsSettings, setupTerms } from "../early/terms";

/** চেকআউট বাটনের আগে টিকবক্স; সাধারণত early.ts আগেই চালু করে দেয়, তখন এখানে কিছু করার থাকে না */
export function mount({ settings }: ToolContext) {
  setupTerms(settings as unknown as TermsSettings);
}
