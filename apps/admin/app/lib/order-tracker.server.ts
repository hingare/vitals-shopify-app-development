import { gql } from "./admin-client.server";
import { cleanEmail } from "./tool-state.server";
import type { GraphqlClient } from "./tools.server";

/**
 * Order Tracker: অর্ডার নম্বর আর সেই অর্ডারের ইমেইল বা ফোন দুটোই মিললে তবেই অবস্থা দেখানো হয়।
 * উত্তরে ঠিকানা, ইমেইল বা ফোন কখনো যায় না; শুধু অবস্থা, কুরিয়ারের ট্র্যাকিং আর কী কী অর্ডার হয়েছিল।
 * খোঁজা হয় Shopify থেকে সরাসরি, তাই আমাদের ডাটাবেসে অর্ডারের কোনো কপি রাখা হয় না।
 *
 * Shopify থেকে শুধু সেই তথ্যই চাওয়া হয় যা দিয়ে ক্রেতা নিজেকে চেনালেন: ইমেইল দিলে ইমেইল, ফোন দিলে ফোন।
 * ইমেইল আর ফোন Shopify-র আলাদা অনুমতির (protected customer fields) তথ্য; অনুমতি নেই এমন তথ্য চাইলে Shopify
 * পুরো উত্তরে error দেয়। আলাদা করে চাওয়ায় ফোনের অনুমতি না থাকলেও ইমেইল দিয়ে খোঁজা চলে।
 */
export interface TrackedOrder {
  name: string;
  createdAt: string;
  cancelled: boolean;
  /** Shopify-র মান, যেমন PAID, PENDING, REFUNDED */
  payment: string | null;
  /** যেমন UNFULFILLED, IN_PROGRESS, FULFILLED */
  fulfillment: string;
  total: string;
  currency: string;
  items: Array<{ title: string; quantity: number }>;
  shipments: Array<{
    /** যেমন IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED (না জানা থাকলে null) */
    status: string | null;
    company: string | null;
    number: string | null;
    url: string | null;
    estimatedDeliveryAt: string | null;
    deliveredAt: string | null;
  }>;
}

interface OrderNode {
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  /** ক্রেতা ইমেইল দিয়ে খুঁজলে তবেই চাওয়া হয় */
  email?: string | null;
  /** বাকি তিনটা ক্রেতা ফোন দিয়ে খুঁজলে তবেই চাওয়া হয় */
  phone?: string | null;
  shippingAddress?: { phone: string | null } | null;
  billingAddress?: { phone: string | null } | null;
  currentTotalPriceSet: { presentmentMoney: { amount: string; currencyCode: string } };
  lineItems: { nodes: Array<{ title: string; quantity: number }> };
  fulfillments: Array<{
    /** SUCCESS, CANCELLED, ERROR বা FAILURE */
    status: string;
    displayStatus: string | null;
    estimatedDeliveryAt: string | null;
    deliveredAt: string | null;
    trackingInfo: Array<{ company: string | null; number: string | null; url: string | null }>;
  }>;
}

/** "#1001", "1001", " hg-1001 " → "1001" বা "HG-1001"; ভুল হলে null */
export function cleanOrderName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/^#/, "").toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{0,29}$/.test(name) ? name : null;
}

/** ফোন নম্বরের শেষ ১০ অঙ্ক (দেশের কোড বা শুরুর ০ থাকুক বা না থাকুক মেলে) */
export function phoneTail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits.slice(-10) : null;
}

export function contactMatches(order: OrderNode, contact: string): boolean {
  const email = cleanEmail(contact);
  if (email) return order.email?.trim().toLowerCase() === email;
  const tail = phoneTail(contact);
  if (!tail) return false;
  return [order.phone, order.shippingAddress?.phone, order.billingAddress?.phone].some(
    (phone) => phoneTail(phone ?? "") === tail,
  );
}

const safeUrl = (url: string | null) => (url && /^https?:\/\/\S+$/.test(url) ? url : null);

export async function trackOrder(
  admin: GraphqlClient,
  input: { order: unknown; contact: unknown },
): Promise<TrackedOrder | null> {
  const name = cleanOrderName(input.order);
  const contact = typeof input.contact === "string" ? input.contact.trim().slice(0, 254) : "";
  if (!name || !contact) return null;
  const byEmail = cleanEmail(contact) !== null;
  if (!byEmail && !phoneTail(contact)) return null;
  const contactFields = byEmail
    ? "email"
    : "phone shippingAddress { phone } billingAddress { phone }";
  const data = await gql<{ orders: { nodes: OrderNode[] } }>(
    admin,
    `#graphql
    query TrackOrder($query: String!) {
      orders(first: 5, query: $query, sortKey: CREATED_AT, reverse: true) {
        nodes {
          name
          createdAt
          cancelledAt
          displayFinancialStatus
          displayFulfillmentStatus
          ${contactFields}
          currentTotalPriceSet { presentmentMoney { amount currencyCode } }
          lineItems(first: 20) { nodes { title quantity } }
          fulfillments(first: 10) {
            status
            displayStatus
            estimatedDeliveryAt
            deliveredAt
            trackingInfo(first: 3) { company number url }
          }
        }
      }
    }`,
    { query: `name:${name}` },
  );
  // Shopify-র খোঁজ কাছাকাছি নামও দিতে পারে, তাই নাম হুবহু মিলিয়ে নিই
  const order = data.orders.nodes.find(
    (node) => node.name.replace(/^#/, "").toUpperCase() === name && contactMatches(node, contact),
  );
  if (!order) return null;
  return {
    name: order.name,
    createdAt: order.createdAt,
    cancelled: Boolean(order.cancelledAt),
    payment: order.displayFinancialStatus,
    fulfillment: order.displayFulfillmentStatus,
    total: order.currentTotalPriceSet.presentmentMoney.amount,
    currency: order.currentTotalPriceSet.presentmentMoney.currencyCode,
    items: order.lineItems.nodes.map((item) => ({ title: item.title, quantity: item.quantity })),
    // বাতিল বা ব্যর্থ হওয়া পার্সেল ক্রেতাকে দেখানো হয় না
    shipments: order.fulfillments
      .filter((f) => f.status === "SUCCESS")
      .map((f) => ({
        status: f.displayStatus,
        company: f.trackingInfo[0]?.company ?? null,
        number: f.trackingInfo[0]?.number ?? null,
        url: safeUrl(f.trackingInfo[0]?.url ?? null),
        estimatedDeliveryAt: f.estimatedDeliveryAt,
        deliveredAt: f.deliveredAt,
      })),
  };
}
