import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { ToolContext } from "../types";
import { track } from "../analytics";
import { fill, isMobile, store } from "../dom";
import { widgetT, type WidgetString } from "../i18n";
import { root } from "../product";
import { proxyPost } from "../proxy";
import { buttonStyle, type Colors, inputStyle, Modal, overlayHost } from "../ui";

const TOOL_ID = "spin-wheel";
const HIDE_KEY = "app_wheel_hidden_until";
const DAY = 86_400_000;
const SIZE = 280;
const R = SIZE / 2;

interface SliceSetting {
  prize: string;
  percentOff: number;
  chance: number;
}

interface Settings {
  trigger: "delay" | "exit" | "scroll";
  delaySeconds: number;
  scrollPercent: number;
  showOn: "everywhere" | "home" | "product";
  heading: string;
  body: string;
  buttonText: string;
  consentText: string;
  frequencyDays: number;
  showOnMobile: boolean;
  colors: Colors;
  [slice: `slice${number}`]: SliceSetting | undefined;
}

export interface WheelSlice {
  /** সেটিংসের ঘর নম্বর (১ থেকে ৬); সার্ভার জেতা ঘরটা এই নম্বরেই জানায় */
  n: number;
  prize: string;
  /** ডিগ্রিতে, উপর থেকে ঘড়ির কাঁটার দিকে */
  start: number;
  end: number;
}

/**
 * চাকার ঘর। প্রতিটা ঘরের মাপ তার জেতার সম্ভাবনার সমান অনুপাতে, তাই চাকা দেখে যা মনে হয় আসল সুযোগও তা-ই।
 * সার্ভারও একই নিয়মে বাদ দেয়: সম্ভাবনা ০ বা লেখা ফাঁকা হলে ঘরটা থাকে না।
 */
export function wheelSlices(settings: Record<string, unknown>): WheelSlice[] {
  const active: Array<SliceSetting & { n: number }> = [];
  for (let n = 1; n <= 6; n++) {
    const slice = settings[`slice${n}`] as SliceSetting | undefined;
    if (slice && slice.chance > 0 && slice.prize) active.push({ n, ...slice });
  }
  const total = active.reduce((sum, slice) => sum + slice.chance, 0);
  let angle = 0;
  return active.map((slice) => {
    const start = angle;
    angle += (slice.chance / total) * 360;
    return { n: slice.n, prize: slice.prize, start, end: angle };
  });
}

/** চাকা কত ডিগ্রি ঘুরলে `n` নম্বর ঘরের মাঝখান উপরের কাঁটার নিচে থামে (কয়েক পাক ঘুরে) */
export function stopRotation(slices: WheelSlice[], n: number, turns = 5): number {
  const slice = slices.find((s) => s.n === n);
  if (!slice) return 0;
  return turns * 360 + (360 - (slice.start + slice.end) / 2);
}

const point = (angle: number, radius: number) => {
  const rad = (angle * Math.PI) / 180;
  return `${(R + radius * Math.sin(rad)).toFixed(2)} ${(R - radius * Math.cos(rad)).toFixed(2)}`;
};

function Wheel({
  slices,
  colors,
  rotation,
  spinning,
  onStop,
}: {
  slices: WheelSlice[];
  colors: Colors;
  rotation: number;
  spinning: boolean;
  onStop: () => void;
}) {
  const fills = [colors.accent, "#ffffff", "#1f2937"];
  return (
    <div style={{ position: "relative", width: `${SIZE}px`, maxWidth: "100%", margin: "0 auto" }}>
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "-6px",
          left: "50%",
          marginLeft: "-10px",
          width: 0,
          height: 0,
          borderLeft: "10px solid transparent",
          borderRight: "10px solid transparent",
          borderTop: "18px solid #111",
          zIndex: 1,
        }}
      />
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={slices.map((slice) => slice.prize).join(", ")}
        onTransitionEnd={onStop}
        style={{
          display: "block",
          width: "100%",
          transform: `rotate(${rotation}deg)`,
          transition: spinning ? "transform 4.5s cubic-bezier(.15,.7,.1,1)" : "none",
        }}
      >
        <circle cx={R} cy={R} r={R - 1} fill="#111" />
        {slices.map((slice, index) => {
          // পাশাপাশি দুই ঘর এক রঙের হয় না (ঘরের সংখ্যা বিজোড় হলে শেষটা তৃতীয় রঙ)
          const last = index === slices.length - 1;
          const fillIndex = last && slices.length % 2 === 1 && slices.length > 1 ? 2 : index % 2;
          const mid = (slice.start + slice.end) / 2;
          const whole = slice.end - slice.start >= 359.99;
          return (
            <g key={slice.n}>
              {whole ? (
                <circle cx={R} cy={R} r={R - 5} fill={fills[0]} />
              ) : (
                <path
                  d={`M${R} ${R}L${point(slice.start, R - 5)}A${R - 5} ${R - 5} 0 ${
                    slice.end - slice.start > 180 ? 1 : 0
                  } 1 ${point(slice.end, R - 5)}Z`}
                  fill={fills[fillIndex]}
                  stroke="#111"
                  stroke-width="1"
                />
              )}
              <text
                x={R + R * 0.58}
                y={R}
                transform={`rotate(${mid - 90} ${R} ${R})`}
                text-anchor="middle"
                dominant-baseline="middle"
                font-size="12"
                font-weight="700"
                fill={fillIndex === 1 ? "#111" : "#fff"}
              >
                {slice.prize}
              </text>
            </g>
          );
        })}
        <circle cx={R} cy={R} r="12" fill="#111" />
      </svg>
    </div>
  );
}

interface SpinResponse {
  slice: number;
  prize: string;
  code: string | null;
  expiresAt: string | null;
}

function WheelPopup({
  s,
  slices,
  locale,
  onClose,
  onSpun,
}: {
  s: Settings;
  slices: WheelSlice[];
  locale: string;
  onClose: () => void;
  onSpun: () => void;
}) {
  const t = (key: WidgetString) => widgetT(locale, key);
  const [state, setState] = useState<"form" | "sending" | "spinning" | "done">("form");
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<SpinResponse | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  async function submit(event: Event) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget as HTMLFormElement).get("email") ?? "");
    setState("sending");
    setError("");
    const res = await proxyPost<SpinResponse>("spin", { email: email.trim() });
    if (!res.ok || !res.data) {
      setState("form");
      const key: WidgetString =
        res.data?.error === "already" ? "spinAlready" : res.status === 429 ? "tooMany" : "tryAgain";
      setError(t(key));
      return;
    }
    track(TOOL_ID, "click");
    onSpun();
    setResult(res.data);
    // কোডটা কুকিতে বসে যায়, তাই চেকআউটে নিজে থেকেই লাগে
    if (res.data.code) {
      void fetch(`${root()}discount/${encodeURIComponent(res.data.code)}`).catch(() => {});
    }
    setRotation(stopRotation(slices, res.data.slice));
    setState(still ? "done" : "spinning");
  }

  let until = "";
  if (result?.expiresAt) {
    try {
      until = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(result.expiresAt),
      );
    } catch {
      until = new Date(result.expiresAt).toLocaleString();
    }
  }

  return (
    <Modal label={s.heading} colors={s.colors} onClose={onClose} closeLabel={t("close")}>
      <div style={{ textAlign: "center", display: "grid", gap: "14px" }}>
        <h2 style={{ margin: 0, fontSize: "22px" }}>{s.heading}</h2>
        <Wheel
          slices={slices}
          colors={s.colors}
          rotation={rotation}
          spinning={state === "spinning"}
          onStop={() => setState("done")}
        />
        {state === "done" && result ? (
          <div role="status" style={{ display: "grid", gap: "10px" }}>
            <strong style={{ fontSize: "18px" }}>
              {result.code ? fill(t("spinWon"), { prize: result.prize }) : t("spinNoPrize")}
            </strong>
            {result.code && (
              <>
                <button
                  type="button"
                  style={{ ...buttonStyle(s.colors, true), borderStyle: "dashed" }}
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(result.code ?? "")
                      .then(() => setCopied(true));
                  }}
                >
                  <strong>{result.code}</strong> · {copied ? t("copied") : t("copy")}
                </button>
                <span>{t("spinApplied")}</span>
                {until && <span>{fill(t("validUntil"), { date: until })}</span>}
              </>
            )}
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: "grid", gap: "10px" }}>
            {s.body && <p style={{ margin: 0 }}>{s.body}</p>}
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              aria-label={t("emailPlaceholder")}
              placeholder={t("emailPlaceholder")}
              style={inputStyle}
            />
            <button type="submit" disabled={state !== "form"} style={buttonStyle(s.colors)}>
              {s.buttonText}
            </button>
            {error && (
              <p role="alert" style={{ margin: 0, color: "#B91C1C" }}>
                {error}
              </p>
            )}
            {s.consentText && (
              <p style={{ margin: 0, fontSize: "12px", opacity: 0.8 }}>{s.consentText}</p>
            )}
          </form>
        )}
      </div>
    </Modal>
  );
}

/** ঠিক সময়ে একবার চাকা দেখায়; বন্ধ করলে বা ঘোরালে নির্দিষ্ট দিন আর দেখায় না */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (!s.showOnMobile && isMobile()) return;
  if (s.showOn === "home" && config.pageType !== "index") return;
  if (s.showOn === "product" && config.pageType !== "product") return;
  if (Number(store.get(HIDE_KEY) ?? 0) > Date.now()) return;
  const slices = wheelSlices(settings);
  if (slices.length === 0) return;
  const snooze = () => store.set(HIDE_KEY, String(Date.now() + s.frequencyDays * DAY));

  let shown = false;
  const show = () => {
    if (shown) return;
    // অন্য পপ-আপ খোলা থাকলে একটু পরে, একসাথে দুটো নয়
    if (document.getElementById("app-popup")) {
      timer = setTimeout(show, 15_000);
      return;
    }
    shown = true;
    cleanup();
    const { host, remove } = overlayHost("app-spin-wheel");
    track(TOOL_ID, "view");
    const close = () => {
      snooze();
      render(null, host);
      remove();
    };
    render(
      <WheelPopup s={s} slices={slices} locale={config.locale} onClose={close} onSpun={snooze} />,
      host,
    );
  };

  const onLeave = (event: MouseEvent) => {
    if (event.clientY <= 0 && !event.relatedTarget) show();
  };
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    if (max <= 0 || (scrollY / max) * 100 >= s.scrollPercent) show();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    clearTimeout(timer);
    document.removeEventListener("mouseout", onLeave);
    removeEventListener("scroll", onScroll);
  };

  // মোবাইলে "পেজ ছেড়ে যাওয়া" বোঝা যায় না, তাই সেখানে কয়েক সেকেন্ড পরে দেখায়
  const trigger = s.trigger === "exit" && isMobile() ? "delay" : s.trigger;
  if (trigger === "delay") timer = setTimeout(show, s.delaySeconds * 1000);
  else if (trigger === "exit") document.addEventListener("mouseout", onLeave);
  else addEventListener("scroll", onScroll, { passive: true });
}
