import { readFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { postgres, type Database } from "../server/db.js";
import { migrate } from "../server/migrate.js";

// Local execution uses PostgreSQL compiled to WASM. TEST_DATABASE_URL opts into
// a real PostgreSQL service and creates only a uniquely named, disposable schema.
// Neither route resets a shared database or touches another run's schema.
export async function testDatabase(): Promise<{
  db: Database;
  dispose(): Promise<void>;
}> {
  if (process.env.TEST_DATABASE_URL) {
    const schema = `api_test_${randomBytes(12).toString("hex")}`;
    const administrative = postgres(process.env.TEST_DATABASE_URL);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set(
      "options",
      `${url.searchParams.get("options") || ""} -c search_path=${schema},public`.trim(),
    );
    const db = postgres(url.toString());
    const dispose = async () => {
      await db.close();
      try {
        await administrative.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await administrative.close();
      }
    };
    try {
      await administrative.query(`CREATE SCHEMA ${schema}`);
      await migrate(db);
      return { db, dispose };
    } catch (error) {
      await dispose();
      throw error;
    }
  }
  const pg = new PGlite();
  const wrap = (connection: any): Database => ({
    query: async (sql, params) => {
      const result = await connection.query(sql, params);
      return { rows: result.rows, rowCount: result.affectedRows ?? null };
    },
    transaction: async (work) =>
      connection.transaction((tx: any) => work(wrap(tx))),
    close: () => pg.close(),
  });
  try {
    const directory = new URL("../migrations/", import.meta.url);
    for (const filename of (await readdir(directory))
      .filter((file) => file.endsWith(".sql"))
      .sort()) {
      await pg.exec(await readFile(new URL(filename, directory), "utf8"));
    }
    return { db: wrap(pg), dispose: () => pg.close() };
  } catch (error) {
    await pg.close();
    throw error;
  }
}
