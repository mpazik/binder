/**
 * SQLite compatibility adapter (Node version).
 *
 * Used when building for Node.js. The Bun build plugin swaps sqlite.bun.ts
 * imports for this file. better-sqlite3 is marked as external in the bundle.
 */
export { default as Database } from "better-sqlite3";
export { drizzle } from "drizzle-orm/better-sqlite3";
export { migrate } from "drizzle-orm/better-sqlite3/migrator";
