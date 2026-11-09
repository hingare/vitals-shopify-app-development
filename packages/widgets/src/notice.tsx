const ICONS = { info: "ℹ️", truck: "🚚", gift: "🎁", clock: "⏰", plain: "" } as const;

export interface NoticeSettings {
  noticeText: string;
  icon: keyof typeof ICONS;
  colors: { background: string; text: string; accent: string };
}

/** Cart Notice-এর বার্তা (কার্ট পেজ আর Cart Drawer দুই জায়গায়) */
export function Notice({ s }: { s: NoticeSettings }) {
  if (!s.noticeText) return null;
  const icon = ICONS[s.icon] ?? "";
  return (
    <p
      role="note"
      style={{
        margin: "12px 0",
        padding: "10px 14px",
        borderRadius: "8px",
        background: s.colors.background,
        color: s.colors.text,
        fontSize: "14px",
      }}
    >
      {icon && (
        <span aria-hidden="true" style={{ marginRight: "6px" }}>
          {icon}
        </span>
      )}
      {s.noticeText}
    </p>
  );
}
