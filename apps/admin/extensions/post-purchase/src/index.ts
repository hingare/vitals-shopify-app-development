import {
  BlockStack,
  Button,
  CalloutBanner,
  Heading,
  Image,
  Layout,
  Select,
  Separator,
  Text,
  TextBlock,
  TextContainer,
  Tiles,
  extend,
} from "@shopify/post-purchase-ui-extensions";
import { APP_URL } from "./app-url";

/** সার্ভার যা পাঠায় (apps/admin/app/lib/post-purchase.server.ts → getPostPurchaseOffer) */
interface Offer {
  offerId: string;
  title: string;
  discount: { value: number; valueType: "percentage" | "fixed_amount"; title: string } | null;
  products: Array<{
    id: string;
    title: string;
    image: string | null;
    variants: Array<{ id: number; title: string; price: string }>;
  }>;
}

const STRINGS = {
  heading: "Add this to your order",
  callout: "It's not too late to add this to your order",
  addProduct: "Add {product} to your order.",
  addPercent: "Add {product} to your order and get {percent}% off.",
  addSave: "Add {product} to your order and save {amount}.",
  noPayment: "No need to enter your payment details again.",
  price: "Price",
  shipping: "Shipping",
  taxes: "Taxes",
  total: "Pay now",
  accept: "Add to order",
  decline: "No thanks",
  option: "Option",
  error: "This item could not be added. Your original order is not affected.",
};

interface PurchaseInput {
  initialPurchase: {
    referenceId: string;
    lineItems: Array<{ product: { id: number } }>;
    totalPriceSet: { shopMoney: { amount: string } };
  };
}

function purchaseBody(input: PurchaseInput) {
  return {
    productIds: input.initialPurchase.lineItems.map((l) => String(l.product.id)),
    total: Number(input.initialPurchase.totalPriceSet.shopMoney.amount) || 0,
  };
}

/** "{product}" ধরনের জায়গায় মান বসায় */
function fill(text: string, values: Record<string, string>) {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

async function post(path: string, token: string, body: unknown) {
  const res = await fetch(`${APP_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
}

extend("Checkout::PostPurchase::ShouldRender", async ({ inputData, storage }) => {
  if (!APP_URL) return { render: false };
  try {
    const data = await post("/api/post-purchase/offer", inputData.token, {
      purchase: purchaseBody(inputData),
    });
    const offer = (data?.offer ?? null) as Offer | null;
    if (!offer) return { render: false };
    await storage.update(offer);
    return { render: true };
  } catch {
    return { render: false };
  }
});

extend(
  "Checkout::PostPurchase::Render",
  (root, { inputData, storage, calculateChangeset, applyChangeset, done }) => {
    const offer = storage.initialData as Offer;
    const product = offer.products[0];
    if (!product) {
      void done();
      return;
    }
    let variantId = product.variants[0]?.id ?? 0;
    let busy = false;
    const money = (amount: string | undefined, currency: string | undefined) => {
      if (amount === undefined) return "…";
      try {
        return new Intl.NumberFormat(inputData.locale, {
          style: "currency",
          currency: currency ?? "USD",
        }).format(Number(amount));
      } catch {
        return amount;
      }
    };

    /**
     * App Store-এর শর্ত ৫.৮.৭: উপরের ব্যানারে প্রোডাক্টের নাম আর ছাড়। শতাংশের ছাড় সাথে সাথেই জানা,
     * নির্দিষ্ট টাকার ছাড় কত বাঁচল তা Shopify-র হিসাবের পরে বসে (ক্রেতার মুদ্রায়)।
     */
    const bannerLine = (saved: string) => {
      const discount = offer.discount;
      if (discount?.valueType === "percentage" && discount.value > 0) {
        return fill(STRINGS.addPercent, {
          product: product.title,
          percent: String(discount.value),
        });
      }
      if (saved) return fill(STRINGS.addSave, { product: product.title, amount: saved });
      return fill(STRINGS.addProduct, { product: product.title });
    };
    const bannerText = root.createText(bannerLine(""));
    // শর্ত ৫.৮.৩: দোকানের আসল দাম কেটে দিয়ে পাশে ছাড়ের দাম, যাতে দাম দোকানের সাথে মেলে
    const originalText = root.createText("");
    const priceText = root.createText("…");
    const shippingText = root.createText("…");
    const taxText = root.createText("…");
    const totalText = root.createText("…");
    const errorMessage = root.createText("");
    const errorText = root.createComponent(TextBlock, { appearance: "critical" }, errorMessage);
    const accept = root.createComponent(
      Button,
      { submit: true, loading: true, onPress: () => void onAccept() },
      STRINGS.accept,
    );
    const decline = root.createComponent(
      Button,
      { subdued: true, onPress: () => void done() },
      STRINGS.decline,
    );

    const row = (label: string, value: ReturnType<typeof root.createText>, strong = false) =>
      root.createComponent(Tiles, {}, [
        root.createComponent(TextBlock, { size: strong ? "medium" : "small" }, label),
        root.createComponent(
          TextContainer,
          { alignment: "trailing" },
          root.createComponent(Text, { emphasized: strong }, value),
        ),
      ]);

    function changes() {
      return [
        {
          type: "add_variant" as const,
          variantId,
          quantity: 1,
          ...(offer.discount ? { discount: offer.discount } : {}),
        },
      ];
    }

    async function recalc() {
      accept.updateProps({ loading: true });
      const result = await calculateChangeset({ changes: changes() });
      if (result.status !== "processed") {
        accept.updateProps({ loading: false, disabled: true });
        return;
      }
      const p = result.calculatedPurchase;
      const line = p.updatedLineItems.find((l) => l.variantId === variantId);
      const m = (bag?: { presentmentMoney: { amount: string; currencyCode: string } }) =>
        money(bag?.presentmentMoney.amount, bag?.presentmentMoney.currencyCode);
      priceText.updateText(m(line?.totalPriceSet));
      const currency = line?.totalPriceSet.presentmentMoney.currencyCode;
      const original = Number(line?.priceSet.presentmentMoney.amount) * (line?.quantity ?? 1);
      const paid = Number(line?.totalPriceSet.presentmentMoney.amount);
      const saved = original > paid ? (original - paid).toFixed(2) : "";
      originalText.updateText(saved ? money(original.toFixed(2), currency) : "");
      bannerText.updateText(bannerLine(saved ? money(saved, currency) : ""));
      shippingText.updateText(m(p.addedShippingLines[0]?.priceSet ?? zero(p.totalOutstandingSet)));
      taxText.updateText(m(p.addedTaxLines[0]?.priceSet ?? zero(p.totalOutstandingSet)));
      totalText.updateText(m(p.totalOutstandingSet));
      accept.updateProps({ loading: false, disabled: false });
    }

    async function onAccept() {
      if (busy) return;
      busy = true;
      accept.updateProps({ loading: true });
      const data = await post("/api/post-purchase/sign", inputData.token, {
        referenceId: inputData.initialPurchase.referenceId,
        offerId: offer.offerId,
        variantId,
        purchase: purchaseBody(inputData),
      }).catch(() => null);
      const token = typeof data?.token === "string" ? data.token : "";
      const result = token ? await applyChangeset(token) : null;
      if (!result || result.errors.length > 0) {
        busy = false;
        accept.updateProps({ loading: false, disabled: true });
        errorMessage.updateText(STRINGS.error);
        return;
      }
      await done();
    }

    const details = [
      root.createComponent(Heading, {}, product.title),
      ...(product.variants.length > 1
        ? [
            root.createComponent(Select, {
              label: STRINGS.option,
              value: String(variantId),
              options: product.variants.map((v) => ({ value: String(v.id), label: v.title })),
              onChange: (value: string) => {
                variantId = Number(value);
                void recalc();
              },
            }),
          ]
        : []),
      root.createComponent(Separator),
      root.createComponent(BlockStack, { spacing: "tight" }, [
        root.createComponent(Tiles, {}, [
          root.createComponent(TextBlock, { size: "small" }, STRINGS.price),
          root.createComponent(TextContainer, { alignment: "trailing" }, [
            root.createComponent(Text, { role: "deletion", subdued: true }, originalText),
            " ",
            root.createComponent(Text, {}, priceText),
          ]),
        ]),
        row(STRINGS.shipping, shippingText),
        row(STRINGS.taxes, taxText),
        row(STRINGS.total, totalText, true),
      ]),
      root.createComponent(BlockStack, {}, [accept, decline, errorText]),
    ];

    root.appendChild(
      root.createComponent(BlockStack, { spacing: "loose" }, [
        root.createComponent(CalloutBanner, { title: offer.title || STRINGS.callout }, [
          root.createComponent(BlockStack, { spacing: "xtight" }, [
            root.createComponent(TextBlock, {}, bannerText),
            root.createComponent(TextBlock, { subdued: true }, STRINGS.noPayment),
          ]),
        ]),
        root.createComponent(
          Layout,
          {
            media: [
              { viewportSize: "small", sizes: [1, 0, 1], maxInlineSize: 0.9 },
              { viewportSize: "medium", sizes: [532, 0.3, 0.5], maxInlineSize: 420 },
              { viewportSize: "large", sizes: [560, 38, 340] },
            ],
          },
          [
            root.createComponent(Image, {
              source: product.image ?? "",
              description: product.title,
            }),
            root.createComponent(BlockStack),
            root.createComponent(BlockStack, {}, details),
          ],
        ),
      ]),
    );
    void recalc();
  },
);

/** একই মুদ্রায় শূন্য (শিপিং বা ট্যাক্স যোগ না হলে) */
function zero(bag: {
  shopMoney: { currencyCode: string };
  presentmentMoney: { currencyCode: string };
}) {
  return {
    shopMoney: { amount: "0", currencyCode: bag.shopMoney.currencyCode },
    presentmentMoney: { amount: "0", currencyCode: bag.presentmentMoney.currencyCode },
  };
}
