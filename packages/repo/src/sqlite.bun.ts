/**
 * SQLite compatibility adapter (Bun version).
 *
 * Used at dev/test time when running under Bun.
 * The build step swaps this for sqlite.node.ts when bundling for Node.
 */
export { Database } from "bun:sqlite";
export { drizzle } from "drizzle-orm/bun-sqlite";
export { migrate } from "drizzle-orm/bun-sqlite/migrator";
