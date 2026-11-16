import { describe, expect, it } from "vitest";
import { contentCollection } from "./collection";

const collection = contentCollection({
  en: [
    { slug: "one", title: "One" },
    { slug: "two", title: "Two" },
  ],
  de: [{ slug: "two", title: "Zwei" }],
});

describe("contentCollection", () => {
  it("shows a language's own pages first, then the default language's missing ones", () => {
    expect(collection.all("de").map((item) => item.title)).toEqual(["Zwei", "One"]);
    expect(collection.all("fr").map((item) => item.title)).toEqual(["One", "Two"]);
  });

  it("finds a page in a language, falling back to the default language", () => {
    expect(collection.get("de", "two")?.title).toBe("Zwei");
    expect(collection.get("de", "one")?.title).toBe("One");
    expect(collection.get("de", "missing")).toBeNull();
  });

  it("lists only the languages a page is really written in", () => {
    expect(collection.languages("two")).toEqual(["en", "de"]);
    expect(collection.languages("one")).toEqual(["en"]);
    expect(collection.slugs()).toEqual(["one", "two"]);
  });
});
