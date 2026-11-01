// Startet eine lokale Postgres-Instanz aus node_modules (kein Docker nötig).
// Daten liegen in .pgdata/, Port 5433, Datenbank "cleaninghub".
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(".pgdata");
const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port: 5433,
  persistent: true,
  onLog: () => {},
});

if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase("cleaninghub");

console.log("Postgres läuft auf localhost:5433 (DB cleaninghub). Strg+C beendet.");

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
