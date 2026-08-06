import fs from "fs";
import path from "path";
import {
  connectDb,
  disconnectDb,
  cleanupByPrefix,
  clearRateLimiterKeys,
} from "./helpers/db";
import type { E2EState } from "./helpers/fixtures";

/**
 * Global teardown (Session 59) — runs once after all journeys:
 *  - Removes every row created by this run (per-run PREFIX on phones, slugs,
 *    names, coupon codes; referential rows resolved through customer/supplier
 *    ids).
 *  - Clears the login/register rate-limiter keys so the next run (or the 33
 *    regression suites) starts clean — the Session 52 convention.
 */
const STATE_FILE = path.resolve(process.cwd(), "tests/e2e/.auth/state.json");

export default async function globalTeardown(): Promise<void> {
  if (!fs.existsSync(STATE_FILE)) {
    // Nothing was set up (e.g. setup failed before writing state) — nothing to clean.
    return;
  }
  let state: E2EState;
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as E2EState;
  } catch {
    return;
  }

  await connectDb();
  await cleanupByPrefix(state.prefix);
  await clearRateLimiterKeys();
  await disconnectDb();
}
