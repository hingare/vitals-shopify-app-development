import { expect, test, type Locator, type Page } from "@playwright/test";
import { axe, blocking, collectErrors, describeViolations, settle } from "./checks";
import { OFFERS } from "./scenarios";
import { openStore, type StoreOptions } from "./store";

/**
 * কীবোর্ড দিয়ে চালানো: পপ-আপ আর প্যানেল খুললে ফোকাস ভেতরে যায়, Tab বাইরে (পেছনের পাতায়) যায় না,
 * Escape বন্ধ করে আর ফোকাস যেখান থেকে খোলা হয়েছিল সেখানে ফেরে। খোলা অবস্থাতেও axe চলে।
 */

const inCart = [{ variant_id: 111, quantity: 1 }];

/** ফোকাস কোথায়: ডায়ালগের ভেতরে, পাতার body-তে (ব্রাউজারের নিজের অংশে), নাকি পেছনের পাতায় */
async function focusPlace(dialog: Locator): Promise<string> {
  return dialog.evaluate((d) => {
    const active = document.activeElement;
    if (!active || active === document.body) return "body";
    if (d.contains(active)) return "inside";
    return `behind: ${active.outerHTML.slice(0, 120)}`;
  });
}

/** খোলার পরেই Shift+Tab, তারপর Tab আর Shift+Tab বারবার: ফোকাস কখনো পেছনের পাতায় যায় না */
async function expectFocusTrapped(page: Page, dialog: Locator) {
  const keys = [
    "Shift+Tab",
    ...Array<string>(10).fill("Tab"),
    ...Array<string>(10).fill("Shift+Tab"),
  ];
  for (const [i, key] of keys.entries()) {
    await page.keyboard.press(key);
    expect(await focusPlace(dialog), `press #${i + 1} (${key})`).toMatch(/^(inside|body)$/);
  }
}

async function expectNoSeriousViolations(page: Page) {
  const violations = blocking(await axe(page));
  expect(violations, describeViolations(violations)).toEqual([]);
}

interface DialogCase {
  tool: string;
  settings?: Record<string, unknown>;
  store?: Omit<StoreOptions, "tools">;
  /** যে বাটন বা লিংক চাপলে খোলে; না দিলে নিজে থেকেই খোলে */
  opener?: string;
  dialog: string;
  /** পেছনের পাতা বন্ধ (aria-modal): ফোকাস ভেতরেই থাকতে হবে */
  modal: boolean;
  /** মেনু-বাটন (disclosure): খুললে ফোকাস বাটনেই থাকে, পরের Tab-এ মেনুতে যায় */
  disclosure?: boolean;
}

const DIALOGS: Record<string, DialogCase> = {
  popup: {
    tool: "popup",
    settings: { delaySeconds: 0 },
    dialog: "#app-popup [role=dialog]",
    modal: true,
  },
  "spin wheel": {
    tool: "spin-wheel",
    settings: { delaySeconds: 0 },
    dialog: "#app-spin-wheel [role=dialog]",
    modal: true,
  },
  "size chart": {
    tool: "size-chart",
    opener: '[data-app-widget="size-chart"] button',
    dialog: "dialog[open]",
    modal: true,
  },
  wishlist: {
    tool: "wishlist",
    opener: "#app-wishlist-launcher button",
    dialog: "#app-wishlist [role=dialog]",
    modal: true,
  },
  "cart drawer": {
    tool: "cart-drawer",
    store: { cart: inCart },
    opener: "#cart-icon-bubble",
    dialog: '[data-app-widget="cart-drawer"] [role=dialog]',
    modal: true,
  },
  "instant search": {
    tool: "instant-search",
    opener: "#Search-In-Header",
    dialog: "#app-instant-search [role=dialog]",
    modal: true,
  },
  "live chat": {
    tool: "live-chat",
    opener: "#app-live-chat > button",
    dialog: "#app-live-chat [role=dialog]",
    modal: false,
  },
  "quick links": {
    tool: "quick-links",
    opener: "#app-quick-links button",
    dialog: "#app-quick-links-menu",
    modal: false,
    disclosure: true,
  },
};

for (const [name, c] of Object.entries(DIALOGS)) {
  test(`${name}: keyboard opens, keeps focus, Escape closes`, async ({ page }) => {
    const errors = collectErrors(page);
    await openStore(page, { ...c.store, tools: [{ id: c.tool, settings: c.settings }] });
    const dialog = page.locator(c.dialog).first();
    let opener: Locator | null = null;
    if (c.opener) {
      opener = page.locator(c.opener).first();
      await expect(opener).toBeVisible();
      await settle(page, 200);
      // ক্রেতা Tab চেপে পৌঁছালে যেমন একবার focus হয় (Playwright-এর focus() দুবার ডাকে)
      await opener.evaluate((el) => (el as HTMLElement).focus());
      // সার্চ ঘরে ফোকাস দিলেই খোলে; বাকিগুলো Enter-এ
      if (!(await dialog.isVisible())) await page.keyboard.press("Enter");
    }
    await expect(dialog).toBeVisible();
    await settle(page, 200);

    if (c.disclosure && opener) {
      await expect(opener).toBeFocused();
      await page.keyboard.press("Tab");
    }
    expect(await focusPlace(dialog), "focus moves into it").toBe("inside");
    // পাশের প্যানেল (চ্যাট, মেনু) পাতা বন্ধ করে না, তাই সেখান থেকে Tab বাইরে যেতে পারে
    if (c.modal) await expectFocusTrapped(page, dialog);
    await expectNoSeriousViolations(page);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    if (opener) await expect(opener, "focus returns to where it was opened from").toBeFocused();
    expect(errors).toEqual([]);
  });
}

test("upsell after add to cart: keyboard reaches it and Escape returns to the button", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openStore(page, { offers: OFFERS, tools: [{ id: "upsells" }] });
  await settle(page, 200);
  const add = page.locator('button[name="add"]');
  await add.focus();
  await page.keyboard.press("Enter");
  const dialog = page.locator('[data-app-widget="upsells"] [role=dialog]');
  await expect(dialog).toBeVisible();
  await settle(page, 200);
  expect(await focusPlace(dialog)).toBe("inside");
  await expectFocusTrapped(page, dialog);
  await expectNoSeriousViolations(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(add).toBeFocused();
  expect(errors).toEqual([]);
});

test("description tabs: arrow keys move between tabs", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "phones get an accordion (native details)");
  await openStore(page, { tools: [{ id: "description-tabs" }] });
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(3);
  await tabs.nth(0).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveText(/organic cotton/);
  await page.keyboard.press("End");
  await expect(tabs.nth(2)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tabs.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tabs.nth(2)).toBeFocused();
  await expectNoSeriousViolations(page);
});

test("agree to terms: checkout waits for the box, then goes on", async ({ page }) => {
  await openStore(page, { page: "cart", cart: inCart, tools: [{ id: "agree-to-terms" }] });
  const box = page.locator(".app-terms input[type=checkbox]");
  await expect(box).toBeVisible();
  const checkout = page.locator('button[name="checkout"]');
  await checkout.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".app-terms-error").first()).toBeVisible();
  await expect(box, "focus goes to the box that needs ticking").toBeFocused();
  await expectNoSeriousViolations(page);
  await page.keyboard.press("Space");
  await expect(box).toBeChecked();
  const submitted = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/cart"));
  await checkout.focus();
  await page.keyboard.press("Enter");
  await submitted;
});

test("back in stock: the whole form works from the keyboard", async ({ page }) => {
  const store = await openStore(page, {
    product: { variantId: 112 },
    tools: [{ id: "back-in-stock" }],
  });
  const notify = page.locator('[data-app-widget="back-in-stock"] button');
  await expect(notify).toBeVisible();
  await notify.focus();
  await page.keyboard.press("Enter");
  const email = page.locator('[data-app-widget="back-in-stock"] input[type=email]');
  await expect(email).toBeFocused();
  await expectNoSeriousViolations(page);
  await page.keyboard.type("rahim@example.com");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-app-widget="back-in-stock"] [role=status]')).toBeVisible();
  expect(store.proxyCalls).toContain("POST back-in-stock");
});

test("reviews: the write-a-review form opens from the keyboard", async ({ page }) => {
  await openStore(page, { tools: [{ id: "product-reviews" }] });
  const write = page.locator("#app-product-reviews button[aria-expanded]");
  await expect(write).toBeVisible();
  await write.focus();
  await page.keyboard.press("Enter");
  await expect(write).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#app-product-reviews form")).toBeVisible();
  await expectNoSeriousViolations(page);
});
