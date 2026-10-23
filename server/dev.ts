/** Local review convenience: an embedded PostgreSQL engine, never the production database. */
import { PGlite } from "@electric-sql/pglite";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { createApp } from "./app.js";
import type { Database } from "./db.js";
const portIndex = process.argv.indexOf("--port");
if (portIndex >= 0 && process.argv[portIndex + 1])
  process.env.PORT = process.argv[portIndex + 1];
if (process.env.NODE_ENV === "production")
  throw new Error("Use npm start for production");
if (process.env.DATABASE_URL) {
  await import("./index.js");
} else {
  const directory = process.env.LOCAL_DATA_DIR || ".local-data";
  await mkdir(directory, { recursive: true });
  const pg = new PGlite(directory);
  const wrap = (connection: any): Database => ({
    query: async (sql, params) => {
      const r = await connection.query(sql, params);
      return { rows: r.rows, rowCount: r.affectedRows ?? null };
    },
    transaction: (fn) => connection.transaction((tx: any) => fn(wrap(tx))),
    close: () => pg.close(),
  });
  const db = wrap(pg);
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())",
  );
  for (const name of (await readdir("migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (
      (
        await db.query("SELECT name FROM schema_migrations WHERE name=$1", [
          name,
        ])
      ).rows.length
    )
      continue;
    const sql = await readFile(`migrations/${name}`, "utf8");
    await pg.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
    });
  }
  process.env.APP_ORIGIN ||=
    process.env.SITES_MANAGED_LINUX_CONTAINER === "1"
      ? "http://terminal.local:4173"
      : `http://localhost:${process.env.PORT || 3000}`;
  const server = createApp(db).listen(
    Number(process.env.PORT || 3000),
    "0.0.0.0",
    () =>
      console.log(
        `TicketPilot local review running on port ${process.env.PORT || 3000}; embedded PostgreSQL development data.`,
      ),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () =>
      server.close(() => {
        void db.close().then(() => process.exit(0));
      }),
    );
}
