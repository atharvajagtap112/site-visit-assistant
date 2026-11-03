import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

// Reuse one pool across Next.js dev reloads.
const globalForPool = globalThis as unknown as { pool?: Pool };
export const pool = globalForPool.pool ?? new Pool({ connectionString: process.env.DATABASE_URL });
if (process.env.NODE_ENV !== "production") globalForPool.pool = pool;

export const db = drizzle(pool, { schema });
