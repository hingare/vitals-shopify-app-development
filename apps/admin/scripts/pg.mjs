/**
 * ব্যাকআপ আর রিস্টোর স্ক্রিপ্টের শেয়ার করা অংশ: ডাটাবেসের ঠিকানা থেকে PostgreSQL-এর টুলের সেটিং,
 * টুল খুঁজে পাওয়া, আর সারির হিসাব মেলানো। কীভাবে চালাবেন: docs/backup-restore.md
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join } from "node:path";

/** ঠিকানার যে প্যারামিটারগুলো PostgreSQL-এর টুল বোঝে (বাকিগুলো, যেমন connection_limit, শুধু Prisma-র) */
const PARAMS = {
  host: "PGHOST",
  port: "PGPORT",
  sslmode: "PGSSLMODE",
  sslrootcert: "PGSSLROOTCERT",
  sslcert: "PGSSLCERT",
  sslkey: "PGSSLKEY",
  sslnegotiation: "PGSSLNEGOTIATION",
  channel_binding: "PGCHANNELBINDING",
  gssencmode: "PGGSSENCMODE",
  connect_timeout: "PGCONNECT_TIMEOUT",
  application_name: "PGAPPNAME",
  options: "PGOPTIONS",
  target_session_attrs: "PGTARGETSESSIONATTRS",
};

/**
 * Prisma-র DATABASE_URL থেকে pg_dump/pg_restore-এর environment। পাসওয়ার্ড কমান্ডে না দিয়ে
 * environment-এ যায়, তাই একই সার্ভারের অন্য কেউ প্রসেসের তালিকায় দেখতে পায় না।
 */
export function pgEnv(databaseUrl) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("The database URL is not a valid URL");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("The database URL must start with postgresql://");
  }
  const env = {};
  const host = decodeURIComponent(url.hostname).replace(/^\[(.*)\]$/, "$1");
  if (host) env.PGHOST = host;
  if (url.port) env.PGPORT = url.port;
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) throw new Error("The database URL has no database name");
  env.PGDATABASE = database;
  if (url.username) env.PGUSER = decodeURIComponent(url.username);
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  for (const [name, value] of url.searchParams) {
    if (PARAMS[name] && value) env[PARAMS[name]] = value;
  }
  return env;
}

/** Prisma-র `schema` প্যারামিটার (না থাকলে public) */
export function schemaOf(databaseUrl) {
  return new URL(databaseUrl).searchParams.get("schema") || "public";
}

/** শেল থেকে পাওয়া PGHOST, PGDATABASE ধরনের সেটিং বাদ দিয়ে শুধু এই ঠিকানার সেটিং, যাতে ভুল ডাটাবেসে না যায় */
export function toolEnv(databaseUrl, base = process.env) {
  const env = Object.fromEntries(Object.entries(base).filter(([key]) => !/^PG[A-Z]+$/.test(key)));
  return { ...env, ...pgEnv(databaseUrl) };
}

/** PostgreSQL-এর টুল: PG_BIN ফোল্ডারে (Windows-এ যেমন C:\Program Files\PostgreSQL\16\bin), নইলে PATH-এ */
export function pgTool(name, env = process.env) {
  return env.PG_BIN ? join(env.PG_BIN, name) : name;
}

/** টুলের মূল সংস্করণ (যেমন 16), না পেলে null */
export function toolMajorVersion(name) {
  const result = spawnSync(pgTool(name), ["--version"], { encoding: "utf8" });
  if (result.error || result.status !== 0) return null;
  const match = /(\d+)(?:\.\d+)?/.exec(result.stdout);
  return match ? Number(match[1]) : null;
}

/** টুল চালিয়ে শেষ হওয়া পর্যন্ত অপেক্ষা; ভুল হলে stderr সহ error। signal বাতিল হলে টুলও থামে */
export function run(name, args, env, signal = undefined) {
  return new Promise((resolve, reject) => {
    const child = spawn(pgTool(name, env), args, {
      env,
      signal,
      stdio: ["ignore", "inherit", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", (error) =>
      reject(
        error.code === "ENOENT"
          ? new Error(`${name} not found. Install the PostgreSQL client tools or set PG_BIN.`)
          : error,
      ),
    );
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${name} exited with code ${code}: ${stderr.trim().slice(-500)}`)),
    );
  });
}

export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/** "নাম"-কে SQL-এর নিরাপদ identifier-এ */
export const quoteIdent = (name) => `"${String(name).replaceAll('"', '""')}"`;

/** স্কিমার সব টেবিল আর প্রতিটায় কয়টা সারি (Prisma client বা transaction দিয়ে) */
export async function countRows(db, schema) {
  const tables = await db.$queryRawUnsafe(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`,
    schema,
  );
  const counts = {};
  for (const { name } of tables) {
    const [{ n }] = await db.$queryRawUnsafe(
      `SELECT count(*)::bigint AS n FROM ${quoteIdent(schema)}.${quoteIdent(name)}`,
    );
    counts[name] = Number(n);
  }
  return counts;
}

/** Prisma-র যে migration-গুলো শেষ হয়েছে (টেবিল না থাকলে খালি) */
export async function appliedMigrations(db, schema) {
  const [{ exists }] = await db.$queryRawUnsafe(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    `${quoteIdent(schema)}."_prisma_migrations"`,
  );
  if (!exists) return [];
  const rows = await db.$queryRawUnsafe(
    `SELECT migration_name AS name FROM ${quoteIdent(schema)}."_prisma_migrations"
     WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
  );
  return rows.map((row) => row.name);
}

/**
 * pg_restore --list-এর তালিকা থেকে স্কিমা বানানোর লাইন (আর তার comment) বাদ: নতুন ডাটাবেসে public স্কিমা
 * আগে থেকেই থাকে, আর সেটা আবার বানাতে গেলে রিস্টোর থেমে যায়
 */
export function withoutSchemaEntry(toc, schema) {
  const name = schema.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const entry = new RegExp(`^\\d+; \\d+ \\d+ (?:SCHEMA - |COMMENT - SCHEMA )${name} `);
  return toc
    .split("\n")
    .filter((line) => !entry.test(line))
    .join("\n");
}

/** ব্যাকআপের সময়ের হিসাব আর রিস্টোরের পরের হিসাব মেলানো */
export function compareCounts(expected, actual) {
  const names = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  const rows = names.map((table) => {
    const want = table in expected ? expected[table] : null;
    const got = table in actual ? actual[table] : null;
    return { table, expected: want, actual: got, ok: want !== null && want === got };
  });
  return { ok: rows.every((row) => row.ok), rows };
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** কমান্ডের --name value */
export function option(args, name, fallback = undefined) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")
    ? args[index + 1]
    : fallback;
}
