import { render } from "preact";
import { useState } from "preact/hooks";
import type { ToolContext } from "../types";
import { track } from "../analytics";
import { fill, footerLink } from "../dom";
import { widgetT, type WidgetString } from "../i18n";
import { PROXY, proxyPost } from "../proxy";
import { buttonStyle, type Colors, inputStyle } from "../ui";

const TOOL_ID = "order-tracker";
const PAGE_ID = "app-order-tracker-page";

interface Settings {
  heading: string;
  body: string;
  buttonText: string;
  notFoundText: string;
  showInFooter: boolean;
  linkText: string;
  colors: Colors;
}

interface Shipment {
  status: string | null;
  company: string | null;
  number: string | null;
  url: string | null;
  estimatedDeliveryAt: string | null;
  deliveredAt: string | null;
}

export interface TrackedOrder {
  name: string;
  createdAt: string;
  cancelled: boolean;
  fulfillment: string;
  total: string;
  currency: string;
  items: Array<{ title: string; quantity: number }>;
  shipments: Shipment[];
}

/** কুরিয়ারের অবস্থা (Shopify-র মান) → ক্রেতার জন্য সহজ লেখা */
export function shipmentStatus(status: string | null): WidgetString {
  switch (status) {
    case "DELIVERED":
      return "trackDelivered";
    case "PICKED_UP":
      return "trackPickedUp";
    case "READY_FOR_PICKUP":
      return "trackReadyForPickup";
    case "OUT_FOR_DELIVERY":
      return "trackOutForDelivery";
    case "IN_TRANSIT":
    case "CARRIER_PICKED_UP":
    case "DELAYED":
      return "trackOnTheWay";
    // লেবেল তৈরি হয়েছে কিন্তু পার্সেল এখনো কুরিয়ারের হাতে যায়নি
    case "LABEL_PRINTED":
    case "LABEL_PURCHASED":
    case "LABEL_VOIDED":
    case "SUBMITTED":
    case "CONFIRMED":
      return "trackPreparing";
    default:
      return "trackShipped";
  }
}

/** পুরো অর্ডারের এক লাইনের অবস্থা */
export function orderStatus(
  order: Pick<TrackedOrder, "cancelled" | "fulfillment" | "shipments">,
): WidgetString {
  if (order.cancelled) return "trackCancelled";
  const full = order.fulfillment === "FULFILLED";
  const statuses = [...new Set(order.shipments.map((s) => shipmentStatus(s.status)))];
  if (!full) {
    const some = statuses.length > 0 || order.fulfillment === "PARTIALLY_FULFILLED";
    return some ? "trackPartlyShipped" : "trackPreparing";
  }
  // সব পার্সেলের অবস্থা এক হলে সেটাই; আলাদা হলে শুধু "Shipped" (বিস্তারিত নিচে প্রতিটার পাশে)
  return statuses.length === 1 && statuses[0] ? statuses[0] : "trackShipped";
}

function date(value: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleDateString();
  }
}

function total(order: TrackedOrder, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: order.currency }).format(
      Number(order.total),
    );
  } catch {
    return `${order.total} ${order.currency}`;
  }
}

function Result({ order, s, locale }: { order: TrackedOrder; s: Settings; locale: string }) {
  const t = (key: WidgetString) => widgetT(locale, key);
  const line = { margin: "4px 0 0" };
  return (
    <div
      role="status"
      style={{
        marginTop: "20px",
        padding: "16px",
        borderRadius: "10px",
        border: "1px solid rgba(0,0,0,.12)",
      }}
    >
      <strong style={{ fontSize: "18px" }}>{order.name}</strong>
      <p style={line}>{fill(t("trackPlaced"), { date: date(order.createdAt, locale) })}</p>
      <p style={{ margin: "10px 0 0", fontSize: "17px", fontWeight: 700, color: s.colors.accent }}>
        {t(orderStatus(order))}
      </p>
      {!order.cancelled &&
        order.shipments.map((shipment, index) => (
          <div key={index} style={{ marginTop: "12px" }}>
            {order.shipments.length > 1 && <strong>{t(shipmentStatus(shipment.status))}</strong>}
            {shipment.number && (
              <p style={line}>
                {t("trackNumber")}: {shipment.company ? `${shipment.company} ` : ""}
                <strong>{shipment.number}</strong>
              </p>
            )}
            {shipment.deliveredAt ? (
              <p style={line}>
                {fill(t("trackDeliveredOn"), { date: date(shipment.deliveredAt, locale) })}
              </p>
            ) : (
              shipment.estimatedDeliveryAt && (
                <p style={line}>
                  {fill(t("trackEstimated"), { date: date(shipment.estimatedDeliveryAt, locale) })}
                </p>
              )
            )}
            {shipment.url && (
              <p style={{ margin: "8px 0 0" }}>
                <a
                  href={shipment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={buttonStyle(s.colors, true)}
                >
                  {t("trackLink")}
                </a>
              </p>
            )}
          </div>
        ))}
      <ul style={{ margin: "14px 0 0", paddingLeft: "18px" }}>
        {order.items.map((item, index) => (
          <li key={index}>
            {item.quantity} × {item.title}
          </li>
        ))}
      </ul>
      <p style={{ margin: "10px 0 0" }}>
        {t("trackTotal")}: <strong>{total(order, locale)}</strong>
      </p>
    </div>
  );
}

function Tracker({ s, locale }: { s: Settings; locale: string }) {
  const t = (key: WidgetString) => widgetT(locale, key);
  const [state, setState] = useState<"form" | "sending">("form");
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [error, setError] = useState("");
  // ইমেইলের লিংকে অর্ডার নম্বর থাকলে সেটা আগে থেকেই বসে (ইমেইল/ফোন কখনো লিংকে থাকে না)
  const preset = new URLSearchParams(location.search).get("order") ?? "";

  async function submit(event: Event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    setState("sending");
    setError("");
    setOrder(null);
    const res = await proxyPost<{ order: TrackedOrder }>("track", {
      order: String(data.get("order") ?? "").trim(),
      contact: String(data.get("contact") ?? "").trim(),
    });
    setState("form");
    if (res.ok && res.data?.order) {
      track(TOOL_ID, "click");
      setOrder(res.data.order);
    } else if (res.status === 404) setError(s.notFoundText);
    else setError(t(res.status === 429 ? "tooMany" : "tryAgain"));
  }

  const label = { display: "grid", gap: "6px", fontWeight: 600 };
  return (
    <div
      style={{
        maxWidth: "520px",
        margin: "32px auto",
        padding: "24px 16px",
        borderRadius: "12px",
        background: s.colors.background,
        color: s.colors.text,
        fontSize: "15px",
        lineHeight: 1.5,
      }}
    >
      <h1 style={{ margin: "0 0 8px", fontSize: "26px" }}>{s.heading}</h1>
      {s.body && <p style={{ margin: "0 0 16px" }}>{s.body}</p>}
      <form onSubmit={submit} style={{ display: "grid", gap: "12px" }}>
        <label style={label}>
          {t("trackOrderNumber")}
          <input
            name="order"
            required
            maxLength={30}
            autoComplete="off"
            defaultValue={preset.slice(0, 30)}
            placeholder="#1001"
            style={inputStyle}
          />
        </label>
        <label style={label}>
          {t("trackContact")}
          <input name="contact" required maxLength={254} autoComplete="email" style={inputStyle} />
        </label>
        <button type="submit" disabled={state === "sending"} style={buttonStyle(s.colors)}>
          {s.buttonText}
        </button>
      </form>
      {error && (
        <p role="alert" style={{ margin: "14px 0 0", color: "#B91C1C" }}>
          {error}
        </p>
      )}
      {order && <Result order={order} s={s} locale={locale} />}
    </div>
  );
}

/**
 * ট্র্যাকিং পেজে (/apps/app-tools/track) ফর্মটা বসায়; অন্য পেজে ফুটারে সেই পেজের লিংক দেয়।
 * অবস্থা দেখতে অর্ডার নম্বরের সাথে সেই অর্ডারের ইমেইল বা ফোন মিলতে হয় (যাচাই সার্ভারে)।
 */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  const page = document.getElementById(PAGE_ID);
  if (page) {
    track(TOOL_ID, "view");
    render(<Tracker s={s} locale={config.locale} />, page);
    return;
  }
  if (s.showInFooter && s.linkText) footerLink(TOOL_ID, s.linkText, `${PROXY}track`);
}
