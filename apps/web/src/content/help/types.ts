/**
 * Help center content. Text may use **bold**, [links](/help/app-embed) and `code`; nothing else is parsed.
 * Facts about a tool (name, plan, settings and their defaults) are NOT written here: the article
 * page reads them from the tool registry and the app's own labels, so they can't go out of date.
 */
export interface ToolArticle {
  /** What the tool does and when it helps: two or three plain sentences */
  intro: string;
  /** Steps between opening the tool and saving it (opening and saving are added automatically) */
  setup: string[];
  /** Steps after saving, such as where to look in the store */
  after?: string[];
  tips?: string[];
  faq?: Array<{ q: string; a: string }>;
  /** Other help articles: tool ids or guide slugs */
  related?: string[];
}

export type Block =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "steps"; items: string[] }
  | { type: "list"; items: string[] }
  | { type: "note"; text: string }
  | { type: "faq"; items: Array<{ q: string; a: string }> }
  /** The first column of each row is its label */
  | { type: "table"; headers: string[]; rows: string[][] };

export interface Guide {
  slug: string;
  title: string;
  /** One or two sentences, used as the summary and the search description */
  description: string;
  body: Block[];
  related?: string[];
}
