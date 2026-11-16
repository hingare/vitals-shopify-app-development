import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Liquid } from "liquidjs";
import { describe, expect, it } from "vitest";

/**
 * থিমের Liquid (AI SEO Schema) liquidjs দিয়ে চালিয়ে দেখা: JSON-LD বৈধ JSON কিনা আর Google-এর দরকারি
 * ঘরগুলো আছে কিনা। Shopify-র নিজস্ব ফিল্টারগুলো (image_url, asset_url, money) এখানে সাধারণ নকল।
 * আসল পরীক্ষা: ডেভ স্টোরে Google Rich Results Test।
 */
const theme = join(__dirname, "../../extensions/theme-embed");
const engine = new Liquid({
  root: [join(theme, "snippets"), join(theme, "blocks")],
  extname: ".liquid",
});
const named = (args: unknown[], key: string) =>
  (args.find((a) => Array.isArray(a) && a[0] === key) as [string, unknown] | undefined)?.[1];
engine.registerFilter("image_url", (image: { src?: string } | string, ...args: unknown[]) => {
  const src = typeof image === "string" ? image : (image?.src ?? "");
  return `//cdn.shopify.com/s/files/${src}?width=${named(args, "width") ?? ""}`;
});
engine.registerFilter("asset_url", (file: string) => `//cdn.shopify.com/extensions/x/${file}`);
engine.registerFilter("money", (cents: number) => `$${(cents / 100).toFixed(2)}`);
engine.registerFilter("payment_type_svg_tag", () => "<svg></svg>");

const schemas = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map(
    (m) => JSON.parse(m[1]!) as Record<string, unknown>,
  );

const SETTINGS = {
  productSchema: true,
  organizationSchema: true,
  breadcrumbSchema: true,
  returnDays: 0,
  returnFees: "free",
  removeThemeDuplicates: false,
};

const variant = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Size ${id}`,
  url: `/products/linen-shirt?variant=${id}`,
  price: 2499,
  available: true,
  sku: `SKU-${id}`,
  barcode: "",
  inventory_management: "shopify",
  inventory_quantity: 5,
  ...extra,
});

const product = {
  id: 1,
  title: 'Linen "Summer" Shirt',
  handle: "linen-shirt",
  url: "/products/linen-shirt",
  vendor: "Acme",
  description: "<p>Light and airy.</p>\n<p>Made of linen.</p>",
  images: [{ src: "a.jpg" }, { src: "b.jpg" }],
  selected_or_first_available_variant: variant(11),
  variants: [
    variant(11, { barcode: "4006381333931" }),
    variant(12, { available: false, barcode: "12AB" }),
    variant(13, { inventory_quantity: 0 }),
  ],
  metafields: { reviews: { rating_count: { value: 3 }, rating: { value: { rating: "4.7" } } } },
};

const base = {
  request: { origin: "https://shop.example", page_type: "product" },
  routes: { root_url: "/" },
  shop: { name: "Example & Co", brand: { logo: { src: "logo.png" }, short_description: "" } },
  cart: { currency: { iso_code: "USD" } },
  localization: { country: { iso_code: "US" } },
  product,
  collection: null as unknown,
};

const render = (data: Record<string, unknown>, settings: Record<string, unknown> = {}) =>
  engine.renderFileSync("ai-seo-schema", {
    ...base,
    ...data,
    s: { ...SETTINGS, ...settings },
    reviews_on: true,
  }) as string;

describe("AI SEO Schema snippet", () => {
  it("describes a product with offers, rating and barcode for Google", () => {
    const [main, crumbs, ...rest] = schemas(render({}));
    expect(rest).toEqual([]);
    expect(main).toMatchObject({
      "@type": "Product",
      name: 'Linen "Summer" Shirt',
      url: "https://shop.example/products/linen-shirt",
      description: "Light and airy. Made of linen.",
      image: [
        "https://cdn.shopify.com/s/files/a.jpg?width=1200",
        "https://cdn.shopify.com/s/files/b.jpg?width=1200",
      ],
      brand: { "@type": "Brand", name: "Acme" },
      sku: "SKU-11",
      aggregateRating: { ratingValue: "4.7", reviewCount: 3, bestRating: 5 },
    });
    const offers = main!.offers as Array<Record<string, unknown>>;
    expect(offers).toHaveLength(3);
    expect(offers[0]).toMatchObject({
      "@type": "Offer",
      url: "https://shop.example/products/linen-shirt?variant=11",
      price: 24.99,
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      name: 'Linen "Summer" Shirt - Size 11',
      gtin: "4006381333931",
    });
    // অক্ষরসহ বারকোড GTIN নয়, তাই দেওয়া হয় না
    expect(offers[1]).not.toHaveProperty("gtin");
    expect(offers[1]!.availability).toBe("https://schema.org/OutOfStock");
    expect(offers[2]!.availability).toBe("https://schema.org/BackOrder");
    expect(offers[0]).not.toHaveProperty("hasMerchantReturnPolicy");
    expect(crumbs).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        { position: 1, name: "Example & Co", item: "https://shop.example/" },
        { position: 2, name: 'Linen "Summer" Shirt' },
      ],
    });
  });

  it("adds the return policy to every offer when the merchant sets one", () => {
    const [main] = schemas(render({}, { returnDays: 30, returnFees: "customer-pays" }));
    for (const offer of main!.offers as Array<Record<string, unknown>>) {
      expect(offer.hasMerchantReturnPolicy).toEqual({
        "@type": "MerchantReturnPolicy",
        applicableCountry: "US",
        returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
        merchantReturnDays: 30,
        returnMethod: "https://schema.org/ReturnByMail",
        returnFees: "https://schema.org/ReturnFeesCustomerResponsibility",
      });
    }
  });

  it("leaves out the rating when there are no reviews, and single-variant names", () => {
    const single = {
      ...product,
      variants: [variant(11)],
      metafields: { reviews: { rating_count: { value: 0 } } },
    };
    const [main] = schemas(render({ product: single }));
    expect(main).not.toHaveProperty("aggregateRating");
    expect((main!.offers as Array<Record<string, unknown>>)[0]).not.toHaveProperty("name");
  });

  it("describes the store on the home page", () => {
    const [site] = schemas(
      render({ request: { origin: "https://shop.example", page_type: "index" } }),
    );
    expect(site!["@graph"]).toEqual([
      {
        "@type": "Organization",
        "@id": "https://shop.example/#organization",
        name: "Example & Co",
        url: "https://shop.example/",
        logo: "https://cdn.shopify.com/s/files/logo.png?width=600",
      },
      {
        "@type": "WebSite",
        "@id": "https://shop.example/#website",
        name: "Example & Co",
        url: "https://shop.example/",
        publisher: { "@id": "https://shop.example/#organization" },
      },
    ]);
  });

  it("gives a collection page its breadcrumb, and a product reached from it three steps", () => {
    const collection = { title: "Shirts", url: "/collections/shirts" };
    const [crumbs] = schemas(
      render({ request: { origin: "https://shop.example", page_type: "collection" }, collection }),
    );
    expect((crumbs!.itemListElement as unknown[]).length).toBe(2);
    const fromCollection = schemas(render({ collection }));
    expect(fromCollection[1]!.itemListElement).toMatchObject([
      { position: 1 },
      { position: 2, name: "Shirts", item: "https://shop.example/collections/shirts" },
      { position: 3, name: 'Linen "Summer" Shirt' },
    ]);
  });

  it("writes nothing for parts the merchant turned off", () => {
    const off = { productSchema: false, organizationSchema: false, breadcrumbSchema: false };
    expect(schemas(render({}, off))).toEqual([]);
    expect(
      schemas(render({ request: { origin: "https://shop.example", page_type: "index" } }, off)),
    ).toEqual([]);
  });
});

describe("app embed", () => {
  const embed = readFileSync(join(theme, "blocks/app-tools-embed.liquid"), "utf8").replace(
    /{%\s*schema\s*%}[\s\S]*?{%\s*endschema\s*%}/,
    "",
  );
  const renderEmbed = (tools: Array<{ id: string; settings: Record<string, unknown> }>) =>
    engine.parseAndRenderSync(
      embed,
      {
        product: base.product,
        collection: base.collection,
        app: { metafields: { app_config: { tools: { value: { tools, placement: {} } } } } },
      },
      // Shopify-র global অবজেক্ট (request, shop ...) snippet-এর ভেতরেও পাওয়া যায়
      { globals: { ...base, product: undefined, collection: undefined } },
    ) as string;
  const products = (html: string) => schemas(html).filter((s) => s["@type"] === "Product");

  it("gives Google one product: the full schema when AI SEO Schema is on, else the rating", () => {
    const reviews = { id: "product-reviews", settings: {} };
    const ratingOnly = products(renderEmbed([reviews]));
    expect(ratingOnly).toHaveLength(1);
    expect(ratingOnly[0]).not.toHaveProperty("offers");
    const full = products(renderEmbed([reviews, { id: "ai-seo-schema", settings: SETTINGS }]));
    expect(full).toHaveLength(1);
    expect(full[0]).toMatchObject({ aggregateRating: { reviewCount: 3 } });
    expect(full[0]!.offers).toHaveLength(3);
  });
});

describe("AI FAQ snippet", () => {
  const faq = {
    items: [
      { question: "Is it <b>washable</b>?", answer: 'Yes, at 30°C.\nDry flat. "Gentle" cycle.' },
      { question: "Does it shrink?", answer: "No." },
    ],
  };
  const s = {
    heading: "Questions",
    faqSchema: true,
    colors: { background: "#FFFFFF", text: "#111827", accent: "#4F46E5" },
  };
  const renderFaq = (data: Record<string, unknown>) =>
    engine.renderFileSync("ai-faq", { faq, s, ...data }) as string;

  it("shows escaped questions and answers with FAQPage schema", () => {
    const html = renderFaq({});
    expect(html).toContain("<summary>Is it &lt;b&gt;washable&lt;/b&gt;?</summary>");
    // Shopify " লেখে &quot;, liquidjs লেখে &#34;; দুটোই নিরাপদ
    expect(html).toMatch(
      /Yes, at 30°C\.<br \/>\nDry flat\. &(quot|#34);Gentle&(quot|#34); cycle\./,
    );
    expect(schemas(html)).toEqual([
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "Is it <b>washable</b>?",
            acceptedAnswer: { "@type": "Answer", text: 'Yes, at 30°C.\nDry flat. "Gentle" cycle.' },
          },
          {
            "@type": "Question",
            name: "Does it shrink?",
            acceptedAnswer: { "@type": "Answer", text: "No." },
          },
        ],
      },
    ]);
  });

  it("can leave out the schema, and shows nothing without questions", () => {
    expect(schemas(renderFaq({ s: { ...s, faqSchema: false } }))).toEqual([]);
    expect(renderFaq({ faq: { items: [] } }).trim()).toBe("");
    expect(renderFaq({ faq: null }).trim()).toBe("");
  });
});
