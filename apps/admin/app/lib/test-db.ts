/**
 * শুধু টেস্টের জন্য: মেমরিতে রাখা ছোট একটা নকল ডাটাবেস (Prisma-র যে অংশটুকু আমরা ব্যবহার করি)।
 * টেস্টে `vi.mock("../db.server", ...)` দিয়ে আসল ডাটাবেসের জায়গায় বসে, তাই টেস্ট "কোন ফাংশন ডাকা হলো"
 * না দেখে "শেষে ডাটাবেসে কী আছে" দেখতে পারে। অচেনা শর্ত পেলে চুপচাপ ভুল ফল না দিয়ে error ছোড়ে।
 */
type Row = Record<string, unknown>;
type Where = Record<string, unknown> | undefined;

function compare(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : (a as number | string);
  const y = b instanceof Date ? b.getTime() : (b as number | string);
  return x < y ? -1 : x > y ? 1 : 0;
}

function test(value: unknown, cond: unknown): boolean {
  if (cond === null) return value === null || value === undefined;
  if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
  if (typeof cond !== "object") return value === cond;
  return Object.entries(cond as Record<string, unknown>).every(([op, arg]) => {
    if (arg === undefined) return true;
    const present = value !== null && value !== undefined;
    switch (op) {
      case "equals":
        return test(value, arg);
      case "in":
        return (arg as unknown[]).includes(value);
      case "notIn":
        return !(arg as unknown[]).includes(value);
      case "not":
        return !test(value, arg);
      case "gt":
        return present && compare(value, arg) > 0;
      case "gte":
        return present && compare(value, arg) >= 0;
      case "lt":
        return present && compare(value, arg) < 0;
      case "lte":
        return present && compare(value, arg) <= 0;
      case "contains":
        return typeof value === "string" && value.includes(arg as string);
      case "startsWith":
        return typeof value === "string" && value.startsWith(arg as string);
      default:
        throw new Error(`test-db: unsupported operator "${op}"`);
    }
  });
}

function matches(row: Row, where: Where): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === "OR") return (cond as Where[]).some((w) => matches(row, w));
    if (key === "AND") return (cond as Where[]).every((w) => matches(row, w));
    if (key === "NOT") return !matches(row, cond as Where);
    // যৌথ unique চাবি, যেমন shopId_email: { shopId, email }
    if (key.includes("_")) return matches(row, cond as Where);
    return test(row[key], cond);
  });
}

function assign(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    const op = value as { increment?: number; decrement?: number } | null;
    if (op && typeof op === "object" && !(value instanceof Date) && !Array.isArray(value)) {
      if (typeof op.increment === "number") {
        row[key] = ((row[key] as number) ?? 0) + op.increment;
        continue;
      }
      if (typeof op.decrement === "number") {
        row[key] = ((row[key] as number) ?? 0) - op.decrement;
        continue;
      }
    }
    row[key] = value;
  }
}

interface Query {
  where?: Where;
  orderBy?: Record<string, "asc" | "desc"> | Array<Record<string, "asc" | "desc">>;
  take?: number;
  skip?: number;
  include?: Record<string, unknown>;
}

export class FakeTable {
  rows: Row[] = [];
  private seq = 0;

  constructor(
    private name: string,
    private defaults: () => Row,
    private unique: string[][] = [],
    private relations: Record<string, (row: Row) => unknown> = {},
  ) {}

  private conflict(data: Row, self?: Row) {
    return this.unique.some((keys) =>
      this.rows.some((r) => r !== self && keys.every((k) => data[k] !== null && r[k] === data[k])),
    );
  }

  private out(row: Row, include?: Record<string, unknown>): Row {
    const copy: Row = { ...row };
    for (const key of Object.keys(include ?? {})) {
      const resolve = this.relations[key];
      if (!resolve) throw new Error(`test-db: ${this.name} has no relation "${key}"`);
      copy[key] = resolve(row);
    }
    return copy;
  }

  private select(query: Query = {}): Row[] {
    let found = this.rows.filter((r) => matches(r, query.where));
    const order = query.orderBy ? [query.orderBy].flat() : [];
    if (order.length > 0) {
      found = [...found].sort((a, b) => {
        for (const rule of order) {
          for (const [field, dir] of Object.entries(rule)) {
            const diff = compare(a[field], b[field]);
            if (diff !== 0) return dir === "desc" ? -diff : diff;
          }
        }
        return 0;
      });
    }
    return found.slice(query.skip ?? 0, query.take ? (query.skip ?? 0) + query.take : undefined);
  }

  /** টেস্টের শুরুতে সারি বসাতে */
  seed(data: Row): Row {
    this.seq++;
    const row: Row = {
      id: `${this.name}${String(this.seq).padStart(4, "0")}`,
      createdAt: new Date(),
      ...this.defaults(),
      ...data,
    };
    this.rows.push(row);
    return row;
  }

  findUnique = async (q: Query) => this.findFirst(q);
  findFirst = async (q: Query = {}) => {
    const row = this.select({ ...q, take: 1 })[0];
    return row ? this.out(row, q.include) : null;
  };
  findMany = async (q: Query = {}) => this.select(q).map((r) => this.out(r, q.include));
  count = async (q: Query = {}) => this.select({ where: q.where }).length;

  create = async ({ data }: { data: Row }) => {
    if (this.conflict({ ...this.defaults(), ...data })) {
      throw new Error(`Unique constraint failed on ${this.name}`);
    }
    return { ...this.seed(data) };
  };

  createMany = async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) => {
    let count = 0;
    for (const item of data) {
      if (this.conflict({ ...this.defaults(), ...item })) {
        if (skipDuplicates) continue;
        throw new Error(`Unique constraint failed on ${this.name}`);
      }
      this.seed(item);
      count++;
    }
    return { count };
  };

  update = async ({ where, data }: { where: Where; data: Row }) => {
    const row = this.select({ where, take: 1 })[0];
    if (!row) throw new Error(`Record to update not found in ${this.name}`);
    assign(row, data);
    return { ...row };
  };

  updateMany = async ({ where, data }: { where?: Where; data: Row }) => {
    const found = this.select({ where });
    for (const row of found) assign(row, data);
    return { count: found.length };
  };

  upsert = async ({ where, create, update }: { where: Where; create: Row; update: Row }) => {
    const row = this.select({ where, take: 1 })[0];
    if (!row) return this.create({ data: create });
    assign(row, update);
    return { ...row };
  };

  delete = async ({ where }: { where: Where }) => {
    const row = this.select({ where, take: 1 })[0];
    if (!row) throw new Error(`Record to delete not found in ${this.name}`);
    this.rows.splice(this.rows.indexOf(row), 1);
    return row;
  };

  deleteMany = async ({ where }: { where?: Where } = {}) => {
    const found = this.select({ where });
    this.rows = this.rows.filter((r) => !found.includes(r));
    return { count: found.length };
  };

  groupBy = async ({ by, where }: { by: string[]; where?: Where }) => {
    const field = by[0] as string;
    const groups = new Map<unknown, number>();
    for (const row of this.select({ where })) {
      groups.set(row[field], (groups.get(row[field]) ?? 0) + 1);
    }
    return [...groups].map(([value, n]) => ({ [field]: value, _count: { _all: n } }));
  };

  reset() {
    this.rows = [];
    this.seq = 0;
  }
}

function build() {
  const shop = new FakeTable(
    "shop",
    () => ({ plan: "professional", uninstalledAt: null, emailSettings: null }),
    [["domain"]],
  );
  const shopOf = (row: Row) => shop.rows.find((s) => s.id === row.shopId) ?? null;
  const table = (name: string, defaults: () => Row, unique: string[][] = []) =>
    new FakeTable(name, defaults, unique, { shop: shopOf });

  return {
    shop,
    toolSetting: table("tool", () => ({ enabled: false, settings: {} }), [["shopId", "toolId"]]),
    integration: table(
      "integration",
      () => ({ config: {}, status: "connected", lastError: null, lastSyncAt: null }),
      [["shopId", "provider"]],
    ),
    subscriber: table(
      "sub",
      () => ({
        status: "subscribed",
        source: "shopify",
        firstName: null,
        phone: null,
        customerId: null,
        consentAt: new Date(),
        unsubscribedAt: null,
        lastOrderAt: null,
      }),
      [["shopId", "email"]],
    ),
    message: table(
      "msg",
      () => ({
        status: "queued",
        refId: null,
        dedupeKey: null,
        error: null,
        attempts: 0,
        providerId: null,
        sendAt: new Date(),
        lockedAt: null,
        sentAt: null,
        deliveredAt: null,
        openedAt: null,
        clickedAt: null,
      }),
      [["shopId", "dedupeKey"]],
    ),
    emailCampaign: table("camp", () => ({
      status: "draft",
      scheduledAt: null,
      sentAt: null,
      recipients: 0,
    })),
    emailFlow: table("flow", () => ({ enabled: false }), [["shopId", "key"]]),
    abandonedCheckout: table("checkout", () => ({ completedAt: null, acceptsMarketing: false }), [
      ["shopId", "token"],
    ]),
    stockAlert: table("alert", () => ({ status: "waiting", notifiedAt: null }), [
      ["shopId", "variantId", "email"],
    ]),
    wheelSpin: table("spin", () => ({ code: null, expiresAt: null })),
    wishlistItem: table("wish", () => ({}), [["shopId", "owner", "productId"]]),
    pushSubscription: table("pushsub", () => ({}), [["shopId", "endpoint"]]),
    pushCampaign: table("push", () => ({ status: "queued", sent: 0, failed: 0, clicks: 0 })),
    withdrawalRequest: table("wd", () => ({ details: "", status: "new" })),
    altTextChange: table("alt", () => ({}), [["shopId", "mediaId"]]),
    job: table("job", () => ({
      payload: {},
      status: "pending",
      error: null,
      attempts: 0,
      progress: null,
      runAt: new Date(),
      startedAt: null,
      finishedAt: null,
    })),
  };
}

export const fakeDb = build();

export function resetFakeDb() {
  for (const table of Object.values(fakeDb)) table.reset();
}
