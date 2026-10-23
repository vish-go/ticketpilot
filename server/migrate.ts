import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { db, type Database } from "./db.js";
export async function migrate(database: Database) {
  await database.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())",
  );
  const dir = path.resolve(process.cwd(), "migrations");
  for (const name of (await readdir(dir))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    await database.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(778901)");
      if (
        (
          await tx.query("SELECT name FROM schema_migrations WHERE name=$1", [
            name,
          ])
        ).rows.length
      )
        return;
      await tx.query(await readFile(path.join(dir, name), "utf8"));
      await tx.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
    });
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await migrate(db);
    console.log("Migrations applied");
  } finally {
    await db.close();
  }
}
