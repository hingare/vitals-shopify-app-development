import type { Block } from "./help/types";

/**
 * Comparison pages and blog posts. Titles and text may use `{brand}` and the plan facts from
 * factValues() (like `{proPrice}`), which are filled in when the page is built.
 */
export interface Comparison {
  slug: string;
  title: string;
  description: string;
  updated: string;
  body: Block[];
}

export interface Post {
  slug: string;
  title: string;
  description: string;
  published: string;
  updated: string;
  body: Block[];
}
