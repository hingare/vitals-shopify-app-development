interface Props {
  settings: {
    position?: "bottom" | "top";
    colors?: { background?: string; text?: string; accent?: string };
  };
}

/** অ্যাডমিনে লাইভ প্রিভিউ: স্টোরের উইজেটের মতোই দেখায় */
export function StickyAtcPreview({ settings }: Props) {
  const colors = settings.colors ?? {};
  const top = settings.position === "top";
  return (
    <div
      style={{
        position: "relative",
        height: 220,
        borderRadius: 12,
        overflow: "hidden",
        background: "linear-gradient(#f4f4f5, #e4e4e7)",
        border: "1px solid #e4e4e7",
      }}
    >
      <div style={{ padding: 16, color: "#71717a", fontSize: 13 }}>Product page</div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          [top ? "top" : "bottom"]: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "10px 14px",
          background: colors.background,
          color: colors.text,
          boxShadow: "0 0 12px rgba(0,0,0,.12)",
          fontSize: 14,
        }}
      >
        <span>Classic T-shirt · $25.00</span>
        <span
          style={{
            background: colors.accent,
            color: "#fff",
            borderRadius: 8,
            padding: "8px 14px",
          }}
        >
          Add to cart
        </span>
      </div>
    </div>
  );
}
