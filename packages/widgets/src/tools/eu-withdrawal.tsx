import { render } from "preact";
import { useState } from "preact/hooks";
import type { ToolContext } from "../types";
import { track } from "../analytics";
import { fill, footerLink } from "../dom";
import { widgetT, type WidgetString } from "../i18n";
import { PROXY, proxyPost } from "../proxy";
import { buttonStyle, type Colors, inputStyle } from "../ui";

const TOOL_ID = "eu-withdrawal";
const PAGE_ID = "app-eu-withdrawal-page";

interface Settings {
  linkText: string;
  heading: string;
  body: string;
  confirmText: string;
  doneText: string;
  showInFooter: boolean;
  colors: Colors;
}

/** সার্ভারে পাঠানোর আগে ফর্মের মান (সার্ভার আবার নিজে যাচাই করে) */
export interface Statement {
  name: string;
  order: string;
  email: string;
  details: string;
}

export function readStatement(data: { get(name: string): unknown }): Statement {
  const value = (name: string) => String(data.get(name) ?? "").trim();
  return {
    name: value("name"),
    order: value("order"),
    email: value("email"),
    details: value("details"),
  };
}

interface Sent {
  statement: Statement;
  /** সার্ভারের দেওয়া তারিখ ও সময়, ইমেইলেও এটাই যায় */
  submitted: string;
}

function Form({ s, locale, preset }: { s: Settings; locale: string; preset: Partial<Statement> }) {
  const t = (key: WidgetString) => widgetT(locale, key);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<Sent | null>(null);

  async function submit(event: Event) {
    event.preventDefault();
    const statement = readStatement(new FormData(event.currentTarget as HTMLFormElement));
    setSending(true);
    setError("");
    const res = await proxyPost<{ submitted: string }>("withdraw", { ...statement, locale });
    setSending(false);
    if (res.ok && res.data?.submitted) {
      track(TOOL_ID, "click");
      setSent({ statement, submitted: res.data.submitted });
    } else setError(t(res.status === 429 ? "tooMany" : "tryAgain"));
  }

  const box = {
    maxWidth: "520px",
    margin: "32px auto",
    padding: "24px 16px",
    borderRadius: "12px",
    background: s.colors.background,
    color: s.colors.text,
    fontSize: "15px",
    lineHeight: 1.5,
  };
  const label = { display: "grid", gap: "6px", fontWeight: 600 };

  if (sent) {
    // জমা পড়ার প্রমাণ পেজেই থাকে (ইমেইল পৌঁছাতে দেরি হলেও ক্রেতা এটা রেখে দিতে পারেন)
    const { statement } = sent;
    const row = { margin: "4px 0 0" };
    return (
      <div style={box} role="status">
        <h1 style={{ margin: "0 0 8px", fontSize: "26px" }}>{s.heading}</h1>
        <p style={{ margin: "0 0 16px", fontWeight: 600 }}>{s.doneText}</p>
        <div style={{ padding: "16px", borderRadius: "10px", border: "1px solid rgba(0,0,0,.12)" }}>
          <p style={{ margin: 0 }}>
            {t("withdrawName")}: <strong>{statement.name}</strong>
          </p>
          <p style={row}>
            {t("withdrawOrder")}: <strong>{statement.order}</strong>
          </p>
          <p style={row}>
            {t("emailPlaceholder")}: <strong>{statement.email}</strong>
          </p>
          {statement.details && (
            <p style={{ ...row, whiteSpace: "pre-wrap" }}>{statement.details}</p>
          )}
          <p style={{ margin: "10px 0 0" }}>
            {fill(t("withdrawSubmitted"), { date: sent.submitted })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={box}>
      <h1 style={{ margin: "0 0 8px", fontSize: "26px" }}>{s.heading}</h1>
      {s.body && <p style={{ margin: "0 0 16px" }}>{s.body}</p>}
      <form onSubmit={submit} style={{ display: "grid", gap: "12px" }}>
        <label style={label}>
          {t("withdrawName")}
          <input
            name="name"
            required
            maxLength={120}
            autoComplete="name"
            defaultValue={preset.name}
            style={inputStyle}
          />
        </label>
        <label style={label}>
          {t("withdrawOrder")}
          <input
            name="order"
            required
            maxLength={40}
            autoComplete="off"
            defaultValue={preset.order}
            placeholder="#1001"
            style={inputStyle}
          />
        </label>
        <label style={label}>
          {t("withdrawEmail")}
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            defaultValue={preset.email}
            style={inputStyle}
          />
        </label>
        <label style={label}>
          {t("withdrawDetails")}
          <textarea name="details" maxLength={1000} rows={3} style={inputStyle} />
          <span style={{ fontWeight: 400, fontSize: "13px", opacity: 0.8 }}>
            {t("withdrawDetailsHelp")}
          </span>
        </label>
        <button type="submit" disabled={sending} style={buttonStyle(s.colors)}>
          {s.confirmText}
        </button>
      </form>
      {error && (
        <p role="alert" style={{ margin: "14px 0 0", color: "#B91C1C" }}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * প্রত্যাহারের পেজে (/apps/app-tools/withdraw) ফর্মটা বসায়; অন্য সব পেজে ফুটারে সেই পেজের লিংক দেয়,
 * যাতে প্রত্যাহারের পথ সব সময় হাতের কাছে থাকে (EU-র নিয়ম)।
 */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  const page = document.getElementById(PAGE_ID);
  if (page) {
    track(TOOL_ID, "view");
    // লগইন করা ক্রেতার নাম আর ইমেইল সার্ভারের Liquid থেকে; অর্ডার নম্বর লিংকে থাকলে সেখান থেকে
    const preset = {
      name: (page.dataset.name ?? "").slice(0, 120),
      email: (page.dataset.email ?? "").slice(0, 254),
      order: (new URLSearchParams(location.search).get("order") ?? "").slice(0, 40),
    };
    render(<Form s={s} locale={config.locale} preset={preset} />, page);
    return;
  }
  if (s.showInFooter && s.linkText) footerLink(TOOL_ID, s.linkText, `${PROXY}withdraw`);
}
