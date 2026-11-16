import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LinksFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { visitorRecordings } from "@app/tools";
import type { Replayer } from "rrweb";
import replayerStyles from "rrweb/dist/style.css?url";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import { enabledSettings } from "../lib/tool-state.server";
import { objectStoreKind } from "../lib/object-store.server";
import {
  deleteRecording,
  getRecording,
  IDLE_MS,
  listRecordings,
  RETENTION_DAYS,
} from "../lib/recordings.server";
import type { DeviceFilter } from "../lib/recordings.server";
import { readUsage } from "../lib/usage.server";
import { ago, minutesSince } from "../lib/ago";
import { useT } from "../lib/i18n";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: replayerStyles }];

const LENGTHS = [0, 30, 120] as const;
const DEVICES: DeviceFilter[] = ["all", "desktop", "mobile"];

type Row = NonNullable<Awaited<ReturnType<typeof getRecording>>>;

function toView(row: Row, now: Date) {
  return {
    id: row.id,
    minutes: minutesSince(row.createdAt, now),
    recordedAt: row.createdAt.toISOString(),
    seconds: Math.round(row.durationMs / 1000),
    device: row.device,
    width: row.width,
    height: row.height,
    entryPath: row.entryPath,
    pages: row.pages,
    pageViews: row.pageViews,
    clicks: row.clicks,
    // এখনো অংশ আসছে (ক্রেতা হয়তো এখনো স্টোরে)
    live: now.getTime() - row.lastChunkAt.getTime() < IDLE_MS && !row.stopped,
  };
}

/**
 * Visitor Recordings-এর পাতা: রেকর্ডিংয়ের তালিকা (?device=, ?min=, ?before=) আর একটার রিপ্লে (?r=)।
 * রিপ্লের রেকর্ড আলাদা করে আসে (/app/recordings/events), তাই পাতা তাড়াতাড়ি খোলে।
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const url = new URL(request.url);
  const now = new Date();
  const selected = url.searchParams.get("r");
  const deviceParam = url.searchParams.get("device") as DeviceFilter | null;
  const device = deviceParam && DEVICES.includes(deviceParam) ? deviceParam : "all";
  const minParam = Number(url.searchParams.get("min"));
  const min = (LENGTHS as readonly number[]).includes(minParam) ? minParam : 0;
  const beforeParam = url.searchParams.get("before");
  const before =
    beforeParam && !Number.isNaN(Date.parse(beforeParam)) ? new Date(beforeParam) : null;

  const [settings, usage, list, recording] = await Promise.all([
    enabledSettings(shop, visitorRecordings),
    readUsage(shop, "recordings", now),
    selected ? null : listRecordings(shop.id, { device, minSeconds: min, before }),
    selected ? getRecording(shop.id, selected) : null,
  ]);
  const rows = list?.rows ?? [];
  return {
    enabled: settings !== null,
    storageReady: objectStoreKind() !== "none",
    retentionDays: RETENTION_DAYS,
    usage: {
      used: usage.used,
      limit: usage.limit,
      resetsAt: usage.resetsAt.toISOString(),
    },
    filters: { device, min, before: before?.toISOString() ?? null },
    rows: rows.map((row) => toView(row, now)),
    next: list?.more ? rows[rows.length - 1]!.createdAt.toISOString() : null,
    selected,
    recording: recording && toView(recording, now),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const body = (await request.json()) as { intent?: string; id?: unknown };
  if (body.intent !== "delete" || typeof body.id !== "string") {
    return { ok: false as const };
  }
  return { ok: await deleteRecording(shop.id, body.id) };
};

type T = ReturnType<typeof useT>;
type View = NonNullable<ReturnType<typeof useLoaderData<typeof loader>>["recording"]>;

/** ৯৫ → "1:35" */
function clock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

const deviceLabel = (t: T, device: string) =>
  device === "mobile" ? t("recordings.mobile") : t("recordings.desktop");

/** লিংকের মতো দেখানো পথ: "%20"-এর মতো অংশ পড়ার মতো করে */
function showPath(path: string) {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

interface ReplayEvent {
  type: number;
  timestamp: number;
  data?: { href?: string };
}

/**
 * rrweb-এর Replayer: রেকর্ডের পাতাগুলো একটা sandbox করা iframe-এ আবার গড়ে, কোনো স্ক্রিপ্ট চলে না।
 * রেকর্ডের পর্দার মাপ অনুযায়ী বাক্সে ছোট করে বসানো হয়।
 */
function Player({ id }: { id: string }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const player = useRef<Replayer | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [total, setTotal] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [skip, setSkip] = useState(true);
  const [visits, setVisits] = useState<Array<{ path: string; at: number }>>([]);

  useEffect(() => {
    let cancelled = false;
    let replayer: Replayer | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    const fit = (width: number, height: number) => {
      const root = box.current;
      if (!replayer || !root || width <= 0 || height <= 0) return;
      const scale = Math.min(root.clientWidth / width, 600 / height, 1);
      replayer.wrapper.style.transformOrigin = "top left";
      replayer.wrapper.style.transform = `scale(${scale})`;
      root.style.height = `${Math.ceil(height * scale)}px`;
    };
    void (async () => {
      try {
        const [{ Replayer: ReplayerClass }, res] = await Promise.all([
          import("rrweb"),
          fetch(`/app/recordings/events?id=${encodeURIComponent(id)}`),
        ]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const events = ((await res.json()) as ReplayEvent[]).sort(
          (a, b) => a.timestamp - b.timestamp,
        );
        if (cancelled || !box.current) return;
        if (!events.some((event) => event.type === 2)) {
          setStatus("empty");
          return;
        }
        const start = events[0]!.timestamp;
        setVisits(
          events
            .filter((event) => event.type === 4 && event.data?.href)
            .map((event) => {
              let path = "/";
              try {
                path = new URL(event.data!.href!).pathname;
              } catch {
                // ভুল ঠিকানা হলে "/"
              }
              return { path, at: event.timestamp - start };
            }),
        );
        replayer = new ReplayerClass(events as never, {
          root: box.current,
          skipInactive: true,
          showWarning: false,
          mouseTail: false,
          triggerFocus: false,
          UNSAFE_replayCanvas: false,
        });
        player.current = replayer;
        replayer.on("resize", (size) => {
          const { width, height } = size as { width: number; height: number };
          fit(width, height);
        });
        replayer.on("finish", () => setPlaying(false));
        setTotal(replayer.getMetaData().totalTime);
        setStatus("ready");
        timer = setInterval(() => {
          if (replayer) setTime(replayer.getCurrentTime());
        }, 250);
      } catch (error) {
        console.error("[recordings] could not load the replay", error);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      clearInterval(timer);
      replayer?.destroy();
      player.current = null;
    };
  }, [id]);

  const seek = (ms: number) => {
    const replayer = player.current;
    if (!replayer) return;
    const at = Math.min(Math.max(0, ms), total);
    if (playing) replayer.play(at);
    else replayer.pause(at);
    setTime(at);
  };

  const toggle = () => {
    const replayer = player.current;
    if (!replayer) return;
    if (playing) {
      replayer.pause();
      setPlaying(false);
      return;
    }
    replayer.play(time >= total - 50 ? 0 : time);
    setPlaying(true);
  };

  const changeSpeed = (next: number) => {
    player.current?.setConfig({ speed: next });
    setSpeed(next);
  };

  const changeSkip = (next: boolean) => {
    player.current?.setConfig({ skipInactive: next });
    setSkip(next);
  };

  return (
    <s-stack direction="block" gap="base">
      {status === "loading" && <s-spinner accessibilityLabel={t("recordings.loading")} />}
      {status === "error" && <s-banner tone="critical">{t("recordings.loadFailed")}</s-banner>}
      {status === "empty" && <s-banner tone="info">{t("recordings.nothingToPlay")}</s-banner>}
      <div
        ref={box}
        style={{
          position: "relative",
          width: "100%",
          overflow: "hidden",
          background: "#f1f1f1",
          borderRadius: "8px",
          display: status === "ready" ? "block" : "none",
        }}
      />
      {status === "ready" && (
        <s-stack direction="block" gap="small-200">
          <input
            type="range"
            min={0}
            max={Math.max(total, 1)}
            step={100}
            value={Math.min(time, total)}
            aria-label={t("recordings.position")}
            onChange={(event) => seek(Number(event.currentTarget.value))}
            style={{ width: "100%" }}
          />
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-button variant="primary" onClick={toggle}>
              {playing ? t("recordings.pause") : t("recordings.play")}
            </s-button>
            <s-text>
              {clock(time / 1000)} / {clock(total / 1000)}
            </s-text>
            {[1, 2, 4, 8].map((value) => (
              <s-button
                key={value}
                variant={speed === value ? "primary" : "secondary"}
                onClick={() => changeSpeed(value)}
                accessibilityLabel={t("recordings.speed", { n: value })}
              >
                {`${value}×`}
              </s-button>
            ))}
            <s-checkbox
              label={t("recordings.skipQuiet")}
              checked={skip}
              onChange={(event) => changeSkip(event.currentTarget.checked)}
            />
          </s-stack>
          {visits.length > 1 && (
            <s-stack direction="block" gap="small-300">
              <s-text type="strong">{t("recordings.pagesVisited")}</s-text>
              <s-stack direction="inline" gap="small-200">
                {visits.map((visit, index) => (
                  <s-button key={`${visit.at}-${index}`} onClick={() => seek(visit.at)}>
                    {`${clock(visit.at / 1000)} ${showPath(visit.path)}`}
                  </s-button>
                ))}
              </s-stack>
            </s-stack>
          )}
        </s-stack>
      )}
    </s-stack>
  );
}

function RecordingPage({ recording }: { recording: View }) {
  const t = useT();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  const [confirming, setConfirming] = useState(false);
  const deleted = fetcher.data?.ok === true;

  useEffect(() => {
    if (deleted) void navigate("/app/recordings");
  }, [deleted, navigate]);

  const remove = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    void fetcher.submit(JSON.stringify({ intent: "delete", id: recording.id }), {
      method: "POST",
      encType: "application/json",
    });
  };

  const facts = [
    ago(t, recording.minutes),
    t("recordings.length", { time: clock(recording.seconds) }),
    deviceLabel(t, recording.device),
    recording.width && recording.height ? `${recording.width}×${recording.height}` : null,
    t("recordings.clicks", { n: recording.clicks }),
  ].filter(Boolean);

  return (
    <s-page heading={t("recordings.player.title")}>
      <s-link slot="breadcrumb-actions" href="/app/recordings">
        {t("recordings.title")}
      </s-link>
      <s-button
        slot="secondary-actions"
        tone="critical"
        onClick={remove}
        loading={fetcher.state !== "idle"}
      >
        {confirming ? t("recordings.deleteConfirm") : t("recordings.delete")}
      </s-button>
      <s-section>
        <s-stack direction="block" gap="small-200">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text>{facts.join(" · ")}</s-text>
            {recording.live && <s-badge tone="info">{t("recordings.live")}</s-badge>}
          </s-stack>
          <s-text color="subdued">
            {t("recordings.entry", { page: showPath(recording.entryPath) })}
          </s-text>
        </s-stack>
      </s-section>
      <s-section>
        <Player id={recording.id} />
      </s-section>
    </s-page>
  );
}

export default function RecordingsPage() {
  const data = useLoaderData<typeof loader>();
  const t = useT();

  if (data.recording) return <RecordingPage recording={data.recording} />;
  if (data.selected) {
    return (
      <s-page heading={t("recordings.title")}>
        <s-link slot="breadcrumb-actions" href="/app/recordings">
          {t("recordings.title")}
        </s-link>
        <s-banner tone="warning">{t("recordings.notFound")}</s-banner>
      </s-page>
    );
  }

  const resets = new Date(data.usage.resetsAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
  });
  const full = data.usage.limit > 0 && data.usage.used >= data.usage.limit;
  const query = (changes: Record<string, string | number | null>) => {
    const params = new URLSearchParams();
    const next = { device: data.filters.device, min: data.filters.min, ...changes };
    if (next.device && next.device !== "all") params.set("device", String(next.device));
    if (next.min) params.set("min", String(next.min));
    if (changes.before) params.set("before", String(changes.before));
    const text = params.toString();
    return text ? `/app/recordings?${text}` : "/app/recordings";
  };

  return (
    <s-page heading={t("recordings.title")}>
      <s-button slot="secondary-actions" href="/app/tools/visitor-recordings">
        {t("recordings.settings")}
      </s-button>
      {!data.enabled && (
        <s-banner tone="warning">
          {t("recordings.off")}{" "}
          <s-link href="/app/tools/visitor-recordings">{t("recordings.turnOn")}</s-link>
        </s-banner>
      )}
      {!data.storageReady && <s-banner tone="warning">{t("recordings.noStorage")}</s-banner>}
      {data.enabled && full && (
        <s-banner tone="warning">{t("recordings.capReached", { date: resets })}</s-banner>
      )}

      <s-section heading={t("recordings.usage.title")}>
        <s-stack direction="block" gap="small-200">
          <s-heading>
            {t("recordings.usage.used", { used: data.usage.used, limit: data.usage.limit })}
          </s-heading>
          <s-text color="subdued">{t("recordings.usage.resets", { date: resets })}</s-text>
          <s-text color="subdued">
            {t("recordings.usage.help", { days: data.retentionDays })}
          </s-text>
        </s-stack>
      </s-section>

      <s-section>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small-200">
            {DEVICES.map((device) => (
              <s-button
                key={device}
                href={query({ device })}
                variant={data.filters.device === device ? "primary" : "secondary"}
              >
                {t(`recordings.filter.${device}`)}
              </s-button>
            ))}
            {LENGTHS.map((min) => (
              <s-button
                key={min}
                href={query({ min })}
                variant={data.filters.min === min ? "primary" : "secondary"}
              >
                {min === 0
                  ? t("recordings.filter.anyLength")
                  : t("recordings.filter.longer", { time: clock(min) })}
              </s-button>
            ))}
          </s-stack>
          {data.rows.length === 0 ? (
            <s-paragraph>
              {data.filters.before ? t("recordings.noMore") : t("recordings.empty")}
            </s-paragraph>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">{t("recordings.when")}</s-table-header>
                <s-table-header>{t("recordings.lengthHeader")}</s-table-header>
                <s-table-header>{t("recordings.pages")}</s-table-header>
                <s-table-header>{t("recordings.clicksHeader")}</s-table-header>
                <s-table-header>{t("recordings.device")}</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.rows.map((row) => (
                  <s-table-row key={row.id}>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200" alignItems="center">
                        <s-link href={`/app/recordings?r=${row.id}`}>{ago(t, row.minutes)}</s-link>
                        {row.live && <s-badge tone="info">{t("recordings.live")}</s-badge>}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>{clock(row.seconds)}</s-table-cell>
                    <s-table-cell>
                      {t("recordings.pageCount", {
                        n: Math.max(row.pageViews, 1),
                        page: showPath(row.entryPath),
                      })}
                    </s-table-cell>
                    <s-table-cell>{String(row.clicks)}</s-table-cell>
                    <s-table-cell>{deviceLabel(t, row.device)}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
          {data.next && (
            <s-stack direction="inline" gap="small-200">
              <s-button href={query({ before: data.next })}>{t("recordings.older")}</s-button>
            </s-stack>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
