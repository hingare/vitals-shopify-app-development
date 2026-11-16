import { contentCollection } from "../collection";
import { posts as en } from "./en";

/** Blog posts, per language. Add a language by adding its folder here. */
export const posts = contentCollection({ en });

/** Newest first */
export function latestPosts(locale: string) {
  return [...posts.all(locale)].sort((a, b) => b.published.localeCompare(a.published));
}
