import { createApp } from "./app.js";
import { db } from "./db.js";
if (
  process.env.NODE_ENV === "production" &&
  !process.env.APP_ORIGIN?.startsWith("https://")
)
  throw new Error("Production requires HTTPS APP_ORIGIN");
const server = createApp(db).listen(Number(process.env.PORT || 3000), () =>
  console.log(
    JSON.stringify({
      event: "server.started",
      port: Number(process.env.PORT || 3000),
    }),
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    server.close(() => {
      void db.close().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
