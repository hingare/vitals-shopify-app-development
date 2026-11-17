import { describe, expect, it } from "vitest";
import {
  compareCounts,
  option,
  pgEnv,
  quoteIdent,
  schemaOf,
  toolEnv,
  withoutSchemaEntry,
} from "./pg.mjs";

describe("database backup and restore helpers", () => {
  it("turns a Prisma DATABASE_URL into PostgreSQL tool settings", () => {
    expect(
      pgEnv(
        "postgresql://app:p%40ss%2Fw0rd@db.example.com:6543/allinone?schema=public&connection_limit=5&sslmode=require",
      ),
    ).toEqual({
      PGHOST: "db.example.com",
      PGPORT: "6543",
      PGDATABASE: "allinone",
      PGUSER: "app",
      PGPASSWORD: "p@ss/w0rd",
      PGSSLMODE: "require",
    });
    expect(pgEnv("postgres://u@[::1]/db").PGHOST).toBe("::1");
    expect(() => pgEnv("mysql://u@h/db")).toThrow(/postgresql/);
    expect(() => pgEnv("postgresql://u@h/")).toThrow(/database name/);
    expect(schemaOf("postgresql://u@h/db")).toBe("public");
    expect(schemaOf("postgresql://u@h/db?schema=shop_app")).toBe("shop_app");
  });

  it("never lets the shell's PG settings point the tools at another database", () => {
    const env = toolEnv("postgresql://u:pw@h/db", {
      PATH: "/bin",
      PGDATABASE: "production",
      PGHOST: "prod.example.com",
      PG_BIN: "/opt/pg/bin",
    });
    expect(env).toEqual({
      PATH: "/bin",
      PG_BIN: "/opt/pg/bin",
      PGHOST: "h",
      PGDATABASE: "db",
      PGUSER: "u",
      PGPASSWORD: "pw",
    });
  });

  it("skips only the schema the new database already has", () => {
    const toc = [
      ";",
      "4; 2615 2200 SCHEMA - public pg_database_owner",
      "3921; 0 0 COMMENT - SCHEMA public pg_database_owner",
      "216; 1259 16390 TABLE public Shop postgres",
      "5; 2615 2201 SCHEMA - public_extra owner",
    ].join("\n");
    expect(withoutSchemaEntry(toc, "public").split("\n")).toEqual([
      ";",
      "216; 1259 16390 TABLE public Shop postgres",
      "5; 2615 2201 SCHEMA - public_extra owner",
    ]);
  });

  it("flags any table whose rows differ or that is missing on either side", () => {
    expect(compareCounts({ Shop: 2, Review: 5 }, { Shop: 2, Review: 5 }).ok).toBe(true);
    const result = compareCounts({ Shop: 2, Review: 5 }, { Shop: 2, Review: 4, Extra: 0 });
    expect(result.ok).toBe(false);
    expect(result.rows.filter((row) => !row.ok).map((row) => row.table)).toEqual([
      "Extra",
      "Review",
    ]);
  });

  it("quotes identifiers and reads command options", () => {
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
    expect(option(["a.dump", "--into", "postgresql://x/y"], "into")).toBe("postgresql://x/y");
    expect(option(["--keep", "--out", "dir"], "keep")).toBeUndefined();
  });
});
