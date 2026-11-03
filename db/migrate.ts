import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index";

await migrate(db, { migrationsFolder: "./db/migrations" });
await pool.end();
console.log("Migrations applied");
