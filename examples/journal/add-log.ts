#!/usr/bin/env bun

// Add Log
//
// Appends a timestamped log entry to today's journal day.
// Creates the day entry (and parent week/month/quarter/year) if needed.
//
// Usage:
//   add-log <message>
//   add-log "Fixed the auth bug"
//   add-log "Lunch with Sara"
//
// Setup:
//   JOURNAL_DIR   Path to your journal workspace directory (required)
//   BINDER_CMD    Command to run binder (optional, default: "binder")

import { execSync } from "child_process";

const CWD = process.env.JOURNAL_DIR;
if (!CWD) {
  console.error("JOURNAL_DIR is not set.");
  console.error('  export JOURNAL_DIR="$HOME/my-journal"');
  process.exit(1);
}

const BINDER = process.env.BINDER_CMD || "binder";

const message = process.argv[2];
if (!message) {
  console.error("Usage: add-log <message>");
  process.exit(1);
}

const now = new Date();
const pad = (n: number) => String(n).padStart(2, "0");
const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

const entry = `${time} - ${message}`;
const ref = `jd-${date}`;

const changeset = JSON.stringify([{ $ref: ref, log: [["insert", entry]] }]);

try {
  execSync(`${BINDER} update`, {
    cwd: CWD,
    input: changeset,
    stdio: ["pipe", "pipe", "pipe"],
  });
  console.log(`Added: ${entry}`);
} catch (e: any) {
  const stderr = e.stderr?.toString().trim();
  console.error(`Failed to add log: ${stderr || e.message}`);
  process.exit(1);
}
