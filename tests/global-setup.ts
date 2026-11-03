import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  // Tests truncate every table, so never let them near the real database.
  if (!url) throw new Error("Set TEST_DATABASE_URL");
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith("_test")) throw new Error("TEST_DATABASE_URL must name a *_test database");

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.href });
  await admin.connect();
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (!rowCount) await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const client = new Client({ connectionString: url });
  await client.connect();
  await migrate(drizzle(client), { migrationsFolder: "./db/migrations" });
  await client.end();
}
