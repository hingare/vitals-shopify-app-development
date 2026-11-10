/** আমাদের সার্ভারের সাথে কথা বলার পথ (Shopify App Proxy: /apps/app-tools/*) */
export const PROXY = "/apps/app-tools/";

export interface ProxyResult<T> {
  ok: boolean;
  status: number;
  /** সার্ভারের JSON; ভুল হলে সাধারণত `{ error: "..." }` */
  data: (T & { error?: string }) | null;
}

export async function proxyPost<T>(path: string, body: unknown): Promise<ProxyResult<T>> {
  try {
    const res = await fetch(PROXY + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as ProxyResult<T>["data"];
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export async function proxyGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(PROXY + path, { headers: { Accept: "application/json" } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}
