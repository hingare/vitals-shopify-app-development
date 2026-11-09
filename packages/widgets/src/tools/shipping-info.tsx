import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { ToolContext } from "../types";
import { track } from "../analytics";
import { deliveryWindow, formatDay, formatDuration } from "../dates";
import { fill } from "../dom";
import { placeAfterProductForm } from "../product";

const TOOL_ID = "shipping-info";

interface Settings {
  minDays: number;
  maxDays: number;
  skipWeekends: boolean;
  cutoffHour: number;
  deliveryMessage: string;
  cutoffMessage: string;
  colors: { background: string; text: string; accent: string };
}

const TRUCK =
  '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>';

function Info({ s, tz, locale }: { s: Settings; tz?: string; locale: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const w = deliveryWindow(now, tz, s);
  const start = formatDay(w.start, locale);
  const end = formatDay(w.end, locale);
  const delivery = fill(s.deliveryMessage, { start, end: end === start ? start : end }).replace(
    `${start} – ${start}`,
    start,
  );
  return (
    <div
      style={{
        margin: "12px 0",
        padding: "12px",
        borderRadius: "8px",
        background: s.colors.background,
        color: s.colors.text,
        display: "flex",
        gap: "10px",
        alignItems: "flex-start",
      }}
    >
      <svg
        aria-hidden="true"
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke={s.colors.accent}
        stroke-width="1.7"
        stroke-linejoin="round"
        style={{ flex: "none" }}
        dangerouslySetInnerHTML={{ __html: TRUCK }}
      />
      <div>
        <div>{delivery}</div>
        {s.cutoffMessage && w.cutoffIn !== null && (
          <div style={{ fontSize: "13px", marginTop: "2px" }}>
            {fill(s.cutoffMessage, { time: formatDuration(w.cutoffIn) })}
          </div>
        )}
      </div>
    </div>
  );
}

export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (config.pageType !== "product") return;
  track(TOOL_ID, "view");
  render(
    <Info s={s} tz={config.tzOffset} locale={config.locale} />,
    placeAfterProductForm(TOOL_ID),
  );
}
