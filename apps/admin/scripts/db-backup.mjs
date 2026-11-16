/**
 * ডাটাবেসের পুরো ব্যাকআপ (pg_dump, custom format) আর পাশে একটা .json: ব্যাকআপের মুহূর্তে প্রতিটা টেবিলে
 * কয়টা সারি ছিল, কোন migration পর্যন্ত, আর ফাইলের sha256। রিস্টোরের পরে db-restore.mjs এগুলো মিলিয়ে দেখে।
 * কীভাবে চালাবেন: docs/backup-restore.md
 *
 *   node scripts/db-backup.mjs                       # DATABASE_URL থেকে, ./backups ফোল্ডারে
 *   node scripts/db-backup.mjs --out /var/backups/allinone --keep 14
 *
 * সারি গোনা আর pg_dump একই snapshot দেখে, তাই অ্যাপ চলতে থাকলেও হিসাব হুবহু মেলে।
 * Prisma-র pooler (pgbouncer) নয়, ডাটাবেসের সরাসরি ঠিকানা দিন।
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  appliedMigrations,
  countRows,
  formatBytes,
  option,
  pgEnv,
  quoteIdent,
  run,
  schemaOf,
  sha256File,
  toolEnv,
  toolMajorVersion,
} from "./pg.mjs";

const args = process.argv.slice(2);
const databaseUrl = process.env.DATABASE_URL;
const outDir = resolve(option(args, "out", "backups"));
const keepText = option(args, "keep");
const keep = keepText === undefined ? null : Number(keepText);

if (!databaseUrl) {
  console.error("Set DATABASE_URL to the database to back up.");
  process.exit(1);
}
if (keep !== null && (!Number.isInteger(keep) || keep < 1)) {
  console.error("--keep must be a whole number of backups to keep, 1 or more.");
  process.exit(1);
}

const schema = schemaOf(databaseUrl);
const database = pgEnv(databaseUrl).PGDATABASE;
const prefix = database.replace(/[^A-Za-z0-9_-]/g, "-");
const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d+Z$/, "Z");
const file = join(outDir, `${prefix}-${stamp}.dump`);
const manifestFile = file.replace(/\.dump$/, ".json");
const BACKUP_NAME = new RegExp(`^${prefix}-\\d{8}T\\d{6}Z\\.dump$`);

if (existsSync(file)) {
  console.error(`${file} already exists. Wait a second and run again.`);
  process.exit(1);
}
const pgDumpMajor = toolMajorVersion("pg_dump");
if (pgDumpMajor === null) {
  console.error(
    "pg_dump not found. Install the PostgreSQL client tools or set PG_BIN to their folder.",
  );
  process.exit(1);
}

const db = new PrismaClient({ datasourceUrl: databaseUrl });
const started = Date.now();
const abort = new AbortController();
let ok = false;

try {
  const [{ server_version: serverVersion }] = await db.$queryRawUnsafe("SHOW server_version");
  const serverMajor = Number.parseInt(serverVersion, 10);
  if (pgDumpMajor < serverMajor) {
    throw new Error(
      `pg_dump ${pgDumpMajor} cannot back up PostgreSQL ${serverMajor}. Install client tools ${serverMajor} or newer.`,
    );
  }
  await mkdir(outDir, { recursive: true });

  const { tables, migrations } = await db.$transaction(
    async (tx) => {
      const [{ snapshot }] = await tx.$queryRawUnsafe("SELECT pg_export_snapshot() AS snapshot");
      const dumping = run(
        "pg_dump",
        [
          "--format=custom",
          `--file=${file}.partial`,
          `--snapshot=${snapshot}`,
          `--schema=${quoteIdent(schema)}`,
          "--lock-wait-timeout=2min",
        ],
        toolEnv(databaseUrl),
        abort.signal,
      );
      // pg_dump চলার সময়েই একই snapshot-এ সারি গোনা
      const counting = (async () => ({
        tables: await countRows(tx, schema),
        migrations: await appliedMigrations(tx, schema),
      }))();
      const [, counted] = await Promise.all([dumping, counting]);
      return counted;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 30_000,
      timeout: 12 * 60 * 60_000,
    },
  );

  const bytes = (await stat(`${file}.partial`)).size;
  const rows = Object.values(tables).reduce((sum, n) => sum + n, 0);
  const manifest = {
    format: 1,
    createdAt: new Date(started).toISOString(),
    database,
    schema,
    serverVersion,
    pgDumpVersion: pgDumpMajor,
    file: basename(file),
    bytes,
    sha256: await sha256File(`${file}.partial`),
    rows,
    tables,
    migrations,
  };
  await writeFile(`${manifestFile}.partial`, `${JSON.stringify(manifest, null, 2)}\n`);
  // সম্পূর্ণ হলেই আসল নাম পায়, যাতে অর্ধেক লেখা ফাইল কখনো ব্যাকআপ মনে না হয়
  await rename(`${file}.partial`, file);
  await rename(`${manifestFile}.partial`, manifestFile);
  ok = true;

  console.log(
    `Backup ${file} (${formatBytes(bytes)}): ${Object.keys(tables).length} tables, ` +
      `${rows.toLocaleString("en-US")} rows, ${migrations.length} migrations, ` +
      `${((Date.now() - started) / 1000).toFixed(1)}s`,
  );

  if (keep !== null) {
    const backups = (await readdir(outDir)).filter((name) => BACKUP_NAME.test(name)).sort();
    for (const old of backups.slice(0, Math.max(0, backups.length - keep))) {
      await rm(join(outDir, old), { force: true });
      await rm(join(outDir, old.replace(/\.dump$/, ".json")), { force: true });
      console.log(`Removed old backup ${old}`);
    }
  }
} catch (error) {
  abort.abort();
  console.error(`Backup failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  if (!ok) {
    await rm(`${file}.partial`, { force: true });
    await rm(`${manifestFile}.partial`, { force: true });
  }
  await db.$disconnect();
}
