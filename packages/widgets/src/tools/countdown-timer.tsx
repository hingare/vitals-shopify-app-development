import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { ToolContext } from "../types";
import { widgetT } from "../i18n";
import { track } from "../analytics";
import { placeAfterProductForm } from "../product";

const TOOL_ID = "countdown-timer";

interface Settings {
  endDate: string;
  endTime: string;
  message: string;
  colors: { background: string; text: string; accent: string };
}

/** "2026-11-30" + "23:59" + "+0600" → সেই মুহূর্ত (ms); ভুল হলে NaN */
export function endsAt(date: string, time: string, tz = "+0000"): number {
  const offset = /^[+-]\d{4}$/.test(tz) ? `${tz.slice(0, 3)}:${tz.slice(3)}` : "Z";
  return Date.parse(`${date}T${time}:00${offset}`);
}

function Timer({
  s,
  end,
  locale,
  onDone,
}: {
  s: Settings;
  end: number;
  locale: string;
  onDone: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const left = Math.max(0, Math.floor((end - now) / 1000));
  useEffect(() => {
    if (left === 0) onDone();
  }, [left, onDone]);

  const parts: Array<[number, Parameters<typeof widgetT>[1]]> = [
    [Math.floor(left / 86400), "days"],
    [Math.floor((left % 86400) / 3600), "hours"],
    [Math.floor((left % 3600) / 60), "minutes"],
    [left % 60, "seconds"],
  ];
  return (
    <div
      style={{
        margin: "16px 0",
        padding: "12px",
        borderRadius: "8px",
        background: s.colors.background,
        color: s.colors.text,
        textAlign: "center",
      }}
    >
      {s.message && <p style={{ margin: "0 0 8px", fontWeight: 600 }}>{s.message}</p>}
      <div role="timer" style={{ display: "flex", justifyContent: "center", gap: "10px" }}>
        {parts.map(([value, unit]) => (
          <div key={unit} style={{ minWidth: "48px" }}>
            <div
              style={{
                fontSize: "22px",
                fontWeight: 700,
                color: s.colors.accent,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {String(value).padStart(2, "0")}
            </div>
            <div style={{ fontSize: "11px", opacity: 0.75 }}>{widgetT(locale, unit)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** সেল শেষ হওয়া পর্যন্ত কাউন্টডাউন; শেষ হলে নিজে থেকে সরে যায় */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (config.pageType !== "product" || !s.endDate) return;
  const end = endsAt(s.endDate, s.endTime, config.tzOffset);
  if (!(end > Date.now())) return;
  const host = placeAfterProductForm(TOOL_ID);
  track(TOOL_ID, "view");
  render(<Timer s={s} end={end} locale={config.locale} onDone={() => render(null, host)} />, host);
}
