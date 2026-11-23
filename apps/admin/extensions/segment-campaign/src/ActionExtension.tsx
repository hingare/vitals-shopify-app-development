import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { campaignLink, segmentGid } from "./segment";

export default function extension() {
  render(<Extension />, document.body);
}

const SEGMENT = `query SegmentCampaignName($id: ID!) {
  segment(id: $id) { name }
}`;

// জটিল সেগমেন্টে Shopify সংখ্যাটা সঙ্গে সঙ্গে দিতে পারে না (ত্রুটি দেয়); তখন সংখ্যা ছাড়াই দেখানো হয়
const SIZE = `query SegmentCampaignSize($id: ID!) {
  customerSegmentMembers(segmentId: $id, first: 1) { totalCount }
}`;

/**
 * "Use segment" থেকে খোলা জানালা: সেগমেন্টের নাম আর গ্রাহকসংখ্যা দেখিয়ে অ্যাপের ক্যাম্পেইন এডিটরে পাঠায়।
 * ইমেইল লেখা, দেখা আর পাঠানো সবই অ্যাপের পাতায় হয়; এখানে কিছু পাঠানো বা বদলানো হয় না।
 */
function Extension() {
  const { i18n } = shopify;
  const id = segmentGid(shopify.data.selected[0]?.id);
  const [name, setName] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(id !== null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    // নাম আর সংখ্যা আলাদা কোয়েরিতে, যাতে একটা ব্যর্থ হলেও অন্যটা দেখায়
    void Promise.allSettled([
      shopify.query<{ segment: { name: string } | null }>(SEGMENT, { variables: { id } }),
      shopify.query<{ customerSegmentMembers: { totalCount: number } | null }>(SIZE, {
        variables: { id },
      }),
    ]).then(([segment, size]) => {
      if (!active) return;
      if (segment.status === "fulfilled") setName(segment.value.data?.segment?.name ?? null);
      if (size.status === "fulfilled") {
        const total = size.value.data?.customerSegmentMembers?.totalCount;
        setCount(typeof total === "number" ? total : null);
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [id]);

  return (
    <s-admin-action heading={i18n.translate("heading")} loading={loading}>
      {id ? (
        <s-stack direction="block" gap="base">
          <s-paragraph>
            {name ? i18n.translate("body", { segment: name }) : i18n.translate("bodyNoName")}
          </s-paragraph>
          {count !== null && (
            <s-paragraph>
              {i18n.translate("members", { count, total: i18n.formatNumber(count) })}
            </s-paragraph>
          )}
          <s-paragraph color="subdued">{i18n.translate("review")}</s-paragraph>
          <s-paragraph color="subdued">{i18n.translate("consent")}</s-paragraph>
        </s-stack>
      ) : (
        <s-banner tone="critical">{i18n.translate("missing")}</s-banner>
      )}
      {id && (
        <s-button slot="primary-action" variant="primary" href={campaignLink(id)}>
          {i18n.translate("create")}
        </s-button>
      )}
      <s-button slot="secondary-actions" onClick={() => shopify.close()}>
        {i18n.translate("cancel")}
      </s-button>
    </s-admin-action>
  );
}
