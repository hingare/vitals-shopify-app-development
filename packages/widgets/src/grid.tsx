import { track } from "./analytics";
import { money } from "./product";
import { type AjaxProduct, imageUrl } from "./product";

/** সুপারিশ আর আগে দেখা প্রোডাক্টের কার্ড-গ্রিড (দুটো টুল একসাথে ব্যবহার করে) */
export function ProductGrid({
  toolId,
  heading,
  products,
  currency,
  locale,
  colors,
}: {
  toolId: string;
  heading: string;
  products: AjaxProduct[];
  currency?: string;
  locale: string;
  colors: { background: string; text: string; accent: string };
}) {
  if (products.length === 0) return null;
  return (
    <section
      aria-label={heading}
      style={{
        margin: "32px auto",
        padding: "0 16px",
        maxWidth: "1200px",
        background: colors.background,
        color: colors.text,
      }}
    >
      {heading && <h2 style={{ margin: "0 0 16px", fontSize: "20px" }}>{heading}</h2>}
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: "16px",
        }}
      >
        {products.map((p) => (
          <li key={p.id}>
            <a
              href={p.url ?? `/products/${p.handle}`}
              onClick={() => track(toolId, "click")}
              style={{ color: "inherit", textDecoration: "none", display: "block" }}
            >
              {p.featured_image && (
                <img
                  src={imageUrl(p.featured_image)}
                  alt=""
                  loading="lazy"
                  width={360}
                  height={360}
                  style={{
                    width: "100%",
                    height: "auto",
                    aspectRatio: "1",
                    objectFit: "cover",
                    borderRadius: "8px",
                  }}
                />
              )}
              <span style={{ display: "block", marginTop: "8px", fontSize: "14px" }}>
                {p.title}
              </span>
              <span style={{ display: "block", fontWeight: 600, color: colors.accent }}>
                {money(p.price, currency, locale)}
                {p.compare_at_price && p.compare_at_price > p.price ? (
                  <s style={{ marginLeft: "6px", opacity: 0.6, fontWeight: 400 }}>
                    {money(p.compare_at_price, currency, locale)}
                  </s>
                ) : null}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
