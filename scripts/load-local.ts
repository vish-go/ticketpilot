/** Actual HTTP load smoke test against a disposable embedded PostgreSQL database. No browser or preview server. */
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createApp } from "../server/app.js";
import type { Database } from "../server/db.js";

if (process.env.NODE_ENV === "production")
  throw new Error("Disposable load test is disabled in production");
process.env.NODE_ENV = "test";
process.env.AI_PROVIDER = "disabled";
process.env.EMAIL_PROVIDER = "disabled";
const pg = new PGlite();
const wrap = (connection: any): Database => ({
  query: async (sql, params) => {
    const result = await connection.query(sql, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? null };
  },
  transaction: (work) => connection.transaction((tx: any) => work(wrap(tx))),
  close: () => pg.close(),
});
let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
try {
  for (const migration of (await readdir("migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await pg.exec(await readFile(`migrations/${migration}`, "utf8"));
  }
  server = createApp(wrap(pg)).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test listener has no TCP port");
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/load.ts"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        LOAD_BASE_URL: `http://127.0.0.1:${address.port}`,
        LOAD_EPHEMERAL: "1",
        LOAD_DATABASE_DESCRIPTION:
          "PGlite 0.5.11, embedded PostgreSQL in memory; all repository migrations applied; no networked database or pool",
      },
    },
  );
  const [code] = await once(child, "exit");
  if (code !== 0) process.exitCode = typeof code === "number" ? code : 1;
} finally {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
  await pg.close();
}
