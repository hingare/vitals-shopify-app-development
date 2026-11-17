/**
 * db-backup.mjs-এর ব্যাকআপ একটা নতুন, খালি ডাটাবেসে ফিরিয়ে আনা, তারপর প্রতিটা টেবিলের সারি আর
 * migration ব্যাকআপের .json-এর সাথে মিলিয়ে দেখা। কিছু না মিললে exit code 1।
 * কীভাবে চালাবেন: docs/backup-restore.md
 *
 *   node scripts/db-restore.mjs backups/allinone-20261116T030000Z.dump --into postgresql://.../allinone_restored
 *
 * চলমান ডাটাবেসে কখনো লেখে না: লক্ষ্যের ডাটাবেসে কোনো টেবিল থাকলে থেমে যায়।
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  appliedMigrations,
  compareCounts,
  countRows,
  formatBytes,
  option,
  pgEnv,
  pgTool,
  run,
  schemaOf,
  sha256File,
  toolEnv,
  toolMajorVersion,
  withoutSchemaEntry,
} from "./pg.mjs";

const args = process.argv.slice(2);
const file = args.find((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
const target = option(args, "into");
const jobs = Number(option(args, "jobs", String(Math.min(4, availableParallelism()))));

if (!file || !target) {
  console.error(
    "Usage: node scripts/db-restore.mjs <backup.dump> --into <postgresql://... new database>",
  );
  process.exit(1);
}
if (!Number.isInteger(jobs) || jobs < 1) {
  console.error("--jobs must be a whole number, 1 or more.");
  process.exit(1);
}

function fail(message) {
  console.error(`Restore failed: ${message}`);
  process.exitCode = 1;
}

const started = Date.now();
let manifest;
try {
  manifest = JSON.parse(await readFile(file.replace(/\.dump$/, ".json"), "utf8"));
} catch {
  fail(
    `${file.replace(/\.dump$/, ".json")} is missing or unreadable; it is written next to every backup.`,
  );
}

if (manifest) {
  const db = new PrismaClient({ datasourceUrl: target });
  try {
    const bytes = (await stat(file)).size;
    if (bytes !== manifest.bytes || (await sha256File(file)) !== manifest.sha256) {
      throw new Error("the backup file does not match its .json (damaged or incomplete copy)");
    }
    if (schemaOf(target) !== manifest.schema) {
      throw new Error(
        `the backup is of schema "${manifest.schema}"; add ?schema=${manifest.schema} to --into`,
      );
    }
    const restoreMajor = toolMajorVersion("pg_restore");
    if (restoreMajor === null) {
      throw new Error("pg_restore not found. Install the PostgreSQL client tools or set PG_BIN.");
    }
    if (restoreMajor < manifest.pgDumpVersion) {
      throw new Error(
        `the backup was made with pg_dump ${manifest.pgDumpVersion}; use pg_restore ${manifest.pgDumpVersion} or newer`,
      );
    }

    const [{ tables }] = await db.$queryRawUnsafe(
      `SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema = $1`,
      manifest.schema,
    );
    const [{ exists }] = await db.$queryRawUnsafe(
      `SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS exists`,
      manifest.schema,
    );
    if (tables > 0 || (exists && manifest.schema !== "public")) {
      throw new Error(
        `database "${pgEnv(target).PGDATABASE}" is not empty. Restore only into a new, empty database.`,
      );
    }

    console.log(
      `Restoring ${manifest.file} (${formatBytes(bytes)}, taken ${manifest.createdAt}) ` +
        `into "${pgEnv(target).PGDATABASE}"...`,
    );
    const toc = spawnSync(pgTool("pg_restore"), ["--list", file], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    if (toc.status !== 0) throw new Error(`cannot read the backup: ${toc.stderr.trim()}`);
    const listDir = await mkdtemp(join(tmpdir(), "db-restore-"));
    try {
      const listFile = join(listDir, "toc.list");
      // নতুন ডাটাবেসে public স্কিমা আগে থেকেই থাকে; সেটা আবার বানানো বাদ দিয়ে বাকি সব ফেরত আনা হয়
      await writeFile(
        listFile,
        exists ? withoutSchemaEntry(toc.stdout, manifest.schema) : toc.stdout,
      );
      await run(
        "pg_restore",
        [
          "--no-owner",
          "--no-privileges",
          "--exit-on-error",
          `--jobs=${jobs}`,
          `--use-list=${listFile}`,
          `--dbname=${pgEnv(target).PGDATABASE}`,
          file,
        ],
        toolEnv(target),
      );
    } finally {
      await rm(listDir, { recursive: true, force: true });
    }
    // রিস্টোরের পরে Postgres-এর পরিসংখ্যান খালি থাকে; না করলে প্রথম দিকের query ধীর চলে
    await db.$executeRawUnsafe("ANALYZE");

    const result = compareCounts(manifest.tables, await countRows(db, manifest.schema));
    const migrations = await appliedMigrations(db, manifest.schema);
    const migrationsMatch = JSON.stringify(migrations) === JSON.stringify(manifest.migrations);

    const width = Math.max(...result.rows.map((row) => row.table.length), 5);
    console.log(`\n${"Table".padEnd(width)}  ${"Backup".padStart(10)}  ${"Restored".padStart(10)}`);
    for (const row of result.rows) {
      console.log(
        `${row.table.padEnd(width)}  ${String(row.expected ?? "-").padStart(10)}  ` +
          `${String(row.actual ?? "-").padStart(10)}  ${row.ok ? "ok" : "MISMATCH"}`,
      );
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (!result.ok || !migrationsMatch) {
      fail(
        `${result.rows.filter((row) => !row.ok).length} tables differ` +
          (migrationsMatch ? "" : ", and the applied migrations differ") +
          `. Do not use this database.`,
      );
    } else {
      console.log(
        `\nRestored and verified in ${seconds}s: ${result.rows.length} tables, ` +
          `${manifest.rows.toLocaleString("en-US")} rows, ${migrations.length} migrations ` +
          `(latest ${migrations.at(-1) ?? "none"}).\n` +
          "To use it: point DATABASE_URL at this database, run `pnpm run setup` " +
          "(applies any newer migrations), then start the app.",
      );
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await db.$disconnect();
  }
}
