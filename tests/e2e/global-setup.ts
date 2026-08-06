import fs from "fs";
import path from "path";
import { request } from "@playwright/test";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import {
  connectDb,
  disconnectDb,
  clearRateLimiterKeys,
} from "./helpers/db";
import { apiLogin } from "./helpers/auth";
import { ADMIN_PHONE, ADMIN_PASSWORD, E2E_PASSWORD } from "./helpers/fixtures";

/**
 * Global setup (Session 59) — runs once before any journey:
 *  1. Connect to the shared dev DB and clear the login/register rate-limiter
 *     keys accumulated by previous runs (Session 52 convention).
 *  2. Ensure the seeded admin exists (idempotent, mirrors seed-admin.js).
 *  3. Create a per-run supplier (admin users API — auto-creates the Supplier
 *     doc) and customer (public register API) with per-run phones.
 *  4. Login all three roles via the REAL credentials API and write
 *     storageState files for the journeys.
 *  5. Persist tests/e2e/.auth/state.json (prefix, ids, phones, state paths).
 *
 * All data carries the per-run prefix → global-teardown removes exactly it.
 */

const AUTH_DIR = path.resolve(process.cwd(), "tests/e2e/.auth");
const STATE_FILE = path.join(AUTH_DIR, "state.json");
const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

let phoneCounter = 0;
/** Per-run unique 11-digit Iranian mobile (09 + 9 digits). */
function genPhone(): string {
  phoneCounter += 1;
  const n = Date.now() % 100000000;
  return `09${String(n).padStart(8, "0")}${phoneCounter}`;
}

export default async function globalSetup(): Promise<void> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  await connectDb();
  await clearRateLimiterKeys();

  const db = mongoose.connection.db;
  if (!db) throw new Error("Not connected to MongoDB");

  const prefix = `e2e_${Date.now()}_`;
  const supplierPhone = genPhone();
  const customerPhone = genPhone();

  // --- 2. Ensure seeded admin exists (idempotent, mirrors seed-admin.js) ---
  const existingAdmin = await db
    .collection("users")
    .findOne({ phone: ADMIN_PHONE });
  if (!existingAdmin) {
    await db.collection("users").insertOne({
      name: "مدیر سیستم",
      phone: ADMIN_PHONE,
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10),
      role: "admin",
      isActive: true,
      address: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // --- 3a. Admin login + storageState ---
  const adminCtx = await request.newContext({ baseURL: BASE_URL });
  await apiLogin(adminCtx, ADMIN_PHONE, ADMIN_PASSWORD);
  const adminStatePath = path.join(AUTH_DIR, "admin.json");
  await adminCtx.storageState({ path: adminStatePath });

  // --- 3b. Create the supplier via the admin users API (auto Supplier doc) ---
  const supplierName = `فروشنده ${prefix}`;
  const supplierRes = await adminCtx.post("/api/admin/users", {
    data: {
      name: supplierName,
      phone: supplierPhone,
      password: E2E_PASSWORD,
      role: "supplier",
    },
  });
  if (supplierRes.status() !== 201) {
    throw new Error(
      `createSupplier → ${supplierRes.status()}: ${(await supplierRes.text()).slice(0, 200)}`
    );
  }
  const supplierBody = (await supplierRes.json()) as {
    _id: string;
    supplierId: string;
  };
  const supplierUserId = supplierBody._id;
  const supplierId = supplierBody.supplierId;

  // --- 3c. Register the customer via the public register API ---
  const customerName = `مشتری ${prefix}`;
  const registerRes = await fetch(`${BASE_URL}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: customerName,
      phone: customerPhone,
      password: E2E_PASSWORD,
    }),
  });
  // Node fetch Response exposes `status` as a property (unlike Playwright's
  // APIResponse `.status()` method).
  if (registerRes.status !== 201) {
    throw new Error(
      `registerCustomer → ${registerRes.status}: ${(await registerRes.text()).slice(0, 200)}`
    );
  }
  const customerBody = (await registerRes.json()) as { id: string };
  const customerId = customerBody.id;

  // --- 4. Supplier + customer logins + storageStates ---
  const supplierCtx = await request.newContext({ baseURL: BASE_URL });
  await apiLogin(supplierCtx, supplierPhone, E2E_PASSWORD);
  const supplierStatePath = path.join(AUTH_DIR, "supplier.json");
  await supplierCtx.storageState({ path: supplierStatePath });

  const customerCtx = await request.newContext({ baseURL: BASE_URL });
  await apiLogin(customerCtx, customerPhone, E2E_PASSWORD);
  const customerStatePath = path.join(AUTH_DIR, "customer.json");
  await customerCtx.storageState({ path: customerStatePath });

  // --- 5. Persist per-run state ---
  const state = {
    prefix,
    baseURL: BASE_URL,
    supplierId,
    supplierUserId,
    customerId,
    supplierPhone,
    customerPhone,
    adminStatePath,
    supplierStatePath,
    customerStatePath,
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");

  await Promise.all([adminCtx.dispose(), supplierCtx.dispose(), customerCtx.dispose()]);
  await disconnectDb();
}
