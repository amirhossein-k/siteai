/**
 * Session 55 — Coupon Eligibility (Private/Targeted Coupons) Verification
 * (real HTTP API)
 *
 * Tests (against the real running Next.js API + real MongoDB):
 *   1. Admin authz: unauth 401, supplier 403 on create-with-eligibility
 *   2. Invalid eligibility payloads → 400 (bad mode, non-ObjectId user,
 *      non-array groups)
 *   3. Create mode:assigned_users (single user + multi-user) → 201 + persisted
 *      shape; admin GET populates assignedUsers (name/phone)
 *   4. Create mode:user_groups → 201 (groups stored lowercase)
 *   5. Validate endpoint is eligibility-aware: non-assigned user → 400 with
 *      the DISTINCT eligibility error (never "invalid coupon"); assigned
 *      user → 200 rules
 *   6. Checkout by a NON-assigned user → 400 eligibility error, NO order, and
 *      NO claim (usedCount stays 0)
 *   7. Checkout by the ASSIGNED user → 201 + discount (claim works)
 *   8. user_groups coupon → checkout by anyone → 400 (groups not implemented
 *      yet — FAIL-CLOSED, never a silent grant)
 *   9. Public coupon (no eligibility) → everyone eligible (default public —
 *      backward compatible)
 *  10. PUT reassigns audience [A] → [B] → 200; B now eligible, A is not
 *  11. Public list LEAK SCAN — eligibility/assignedUsers/groups never exposed
 *
 * Requires: dev server on http://localhost:3000, real DB.
 * Usage: node scripts/verify-coupon-eligibility.js
 *
 * IMPORTANT: the suite cleans up its own PREFIX'd fixtures (coupons, orders,
 * products, users, suppliers, couponusages). It must run AFTER
 * verify-coupons-marketing in the sequential regression (which wholesale-wipes
 * the shared couponusages/ratelimits collections).
 */
const fs = require("fs");
const path = require("path");

const envPath = path.resolve(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const BASE = "http://localhost:3000";
const DB_NAME = "marlooai";
const PREFIX = "celig_" + Date.now() + "_";
const PASS = "celig-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";

// Distinct eligibility error (must match src/lib/coupons.ts)
const ELIG_ERROR = "این کد تخفیف برای شما قابل استفاده نیست";

let passed = 0, failed = 0, total = 0;

async function testAsync(name, fn) {
  total++;
  process.stdout.write("\n  [TEST " + total + "] " + name + " ... ");
  try { await fn(); console.log("PASS"); passed++; }
  catch (err) { console.log("FAIL: " + err.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }

function makeJar() {
  const cookies = {};
  return {
    get(headers) {
      let entries = [];
      if (headers && typeof headers.getSetCookie === "function") entries = headers.getSetCookie();
      else if (Array.isArray(headers)) entries = headers;
      for (const entry of entries) {
        const [pair] = entry.split(";");
        const eq = pair.indexOf("=");
        if (eq < 1) continue;
        const key = pair.slice(0, eq).trim();
        let value = pair.slice(eq + 1).trim();
        if (value.startsWith('"')) value = value.slice(1);
        if (value.endsWith('"')) value = value.slice(0, -1);
        cookies[key] = value;
      }
    },
    header() { return Object.entries(cookies).map(([k, v]) => k + "=" + v).join("; "); },
  };
}

async function login(phone, password) {
  const jar = makeJar();
  let res = await fetch(BASE + "/api/auth/csrf");
  jar.get(res.headers);
  const { csrfToken } = await res.json();
  const form = new URLSearchParams({ csrfToken, phone, password, json: "true" });
  res = await fetch(BASE + "/api/auth/callback/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest", Cookie: jar.header() },
    body: form.toString(),
    redirect: "manual",
  });
  jar.get(res.headers);
  return jar;
}

async function http(method, urlPath, jar, body) {
  const headers = {};
  if (jar) headers.Cookie = jar.header();
  let requestBody = body;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }
  const res = await fetch(BASE + urlPath, { method, headers, body: requestBody, redirect: "manual" });
  if (jar) jar.get(res.headers);
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: res.status, data };
}

// --- Minimal schemas (fixtures only; the API routes use the real models) ---
const UserSchema = new mongoose.Schema(
  { name: String, phone: String, passwordHash: String, role: String, supplier: { type: mongoose.Schema.Types.ObjectId, default: null }, isActive: Boolean },
  { timestamps: true, collection: "users" }
);
const SupplierSchema = new mongoose.Schema(
  { user: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, businessName: String, contactPhone: String, isActive: Boolean },
  { timestamps: true, collection: "suppliers" }
);
const CategorySchema = new mongoose.Schema(
  { name: String, slug: String, isActive: Boolean },
  { timestamps: true, collection: "categories" }
);
const ProductSchema = new mongoose.Schema(
  {
    name: String, slug: { type: String, unique: true }, description: String,
    images: [String], category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" },
    supplierPrice: Number, price: Number, stock: Number, stockVersion: Number,
    hasVariants: Boolean, variants: { type: [mongoose.Schema.Types.Mixed], default: [] },
    isActive: Boolean,
  },
  { timestamps: true, collection: "products" }
);

/** Recursively collect every key in a parsed JSON value (leak scan). */
function collectKeys(node, into) {
  if (Array.isArray(node)) {
    for (const item of node) collectKeys(item, into);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      into.add(k);
      collectKeys(v, into);
    }
  }
}

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 55 — COUPON ELIGIBILITY (PRIVATE/TARGETED COUPONS)");
  console.log("==================================================================");

  try {
    const ping = await fetch(BASE + "/api/auth/csrf");
    assert(ping.status === 200, "dev server not reachable");
    console.log("\n  Dev server reachable\n");
  } catch {
    console.error("\nERROR: dev server not reachable. Start it with: npm run dev");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, { dbName: DB_NAME });
  const db = mongoose.connection.db;
  const User = mongoose.models.User_CELIG || mongoose.model("User_CELIG", UserSchema);
  const Supplier = mongoose.models.Supplier_CELIG || mongoose.model("Supplier_CELIG", SupplierSchema);
  const Category = mongoose.models.Category_CELIG || mongoose.model("Category_CELIG", CategorySchema);
  const Product = mongoose.models.Product_CELIG || mongoose.model("Product_CELIG", ProductSchema);

  // --- Idempotency sweep (own PREFIX'd rows only) ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("coupons").deleteMany({ code: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "discount.code": { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: { $regex: "^0915" }, name: { $regex: "^CELig" } });
  await Supplier.deleteMany({ businessName: { $regex: "^CELigTest" } });

  // --- Fixtures: 1 supplier + product + 3 customers (A, B, C) ---
  const phones = ["09157772301", "09157772302", "09157772303"];
  const customers = [];
  for (let i = 0; i < 3; i++) {
    customers.push(await User.create({ name: "CELig Customer " + (i + 1), phone: phones[i], passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true }));
  }
  const [userA, userB, userC] = customers;

  const suppUser = await User.create({ name: "CELig Supplier", phone: "09157772304", passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppDoc = await Supplier.create({ user: suppUser._id, businessName: "CELigTest Supplier Co", contactPhone: "09157772304", isActive: true });
  await User.findByIdAndUpdate(suppUser._id, { $set: { supplier: suppDoc._id } });
  const catDoc = await Category.create({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true });
  const prod1 = await Product.create({ name: PREFIX + "prod-1", slug: PREFIX + "prod-1", description: "celig test", images: ["https://example.com/c1.jpg"], category: catDoc._id, supplier: suppDoc._id, price: 100000, supplierPrice: 50000, stock: 20, stockVersion: 0, hasVariants: false, variants: [], isActive: true });

  let adminJar = null, customerAJar = null, customerBJar = null, customerCJar = null, supplierJar = null;

  await testAsync("Seed admin login", async () => {
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    assert(adminJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Customer A login", async () => {
    customerAJar = await login(phones[0], PASS);
    assert(customerAJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Customer B login", async () => {
    customerBJar = await login(phones[1], PASS);
    assert(customerBJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Customer C login", async () => {
    customerCJar = await login(phones[2], PASS);
    assert(customerCJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Supplier login", async () => {
    supplierJar = await login("09157772304", PASS);
    assert(supplierJar.header().includes("session-token"), "no session cookie");
  });

  // --- TEST: admin authz (eligibility create) ---
  const singleCode = PREFIX.toUpperCase() + "ONE";
  let singleId = null;
  await testAsync("Admin authz: unauth 401; supplier 403 on create with eligibility", async () => {
    const payload = { code: singleCode, type: "percent", value: 10, eligibility: { mode: "assigned_users", assignedUsers: [userA._id.toString()], groups: [] } };
    const unauth = await http("POST", "/api/admin/coupons", null, payload);
    assert(unauth.status === 401, "unauth must be 401, got " + unauth.status);
    const forbidden = await http("POST", "/api/admin/coupons", supplierJar, payload);
    assert(forbidden.status === 403, "supplier must be 403, got " + forbidden.status);
  });

  // --- TEST: invalid eligibility payloads → 400 ---
  await testAsync("Invalid eligibility payloads -> 400 (bad mode / bad user id / non-array groups)", async () => {
    const base = { code: PREFIX.toUpperCase() + "BAD", type: "fixed", value: 1000 };
    const badMode = await http("POST", "/api/admin/coupons", adminJar, { ...base, eligibility: { mode: "everyone", assignedUsers: [], groups: [] } });
    assert(badMode.status === 400, "bad mode must be 400, got " + badMode.status);
    const badUser = await http("POST", "/api/admin/coupons", adminJar, { ...base, code: PREFIX.toUpperCase() + "BAD2", eligibility: { mode: "assigned_users", assignedUsers: ["not-an-object-id"], groups: [] } });
    assert(badUser.status === 400, "bad user id must be 400, got " + badUser.status);
    const badGroups = await http("POST", "/api/admin/coupons", adminJar, { ...base, code: PREFIX.toUpperCase() + "BAD3", eligibility: { mode: "user_groups", assignedUsers: [], groups: "vip" } });
    assert(badGroups.status === 400, "non-array groups must be 400, got " + badGroups.status);
  });

  // --- TEST: create assigned_users single + multi ---
  await testAsync("Create assigned_users coupon [A] -> 201 + persisted shape", async () => {
    const res = await http("POST", "/api/admin/coupons", adminJar, {
      code: singleCode, type: "percent", value: 10,
      eligibility: { mode: "assigned_users", assignedUsers: [userA._id.toString()], groups: [] },
    });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(res.data.eligibility.mode === "assigned_users", "mode not persisted");
    assert(Array.isArray(res.data.eligibility.assignedUsers) && res.data.eligibility.assignedUsers.length === 1, "assignedUsers not persisted");
    assert(String(res.data.eligibility.assignedUsers[0]) === String(userA._id), "wrong assigned user");
    singleId = res.data._id;
  });

  const multiCode = PREFIX.toUpperCase() + "ABC";
  let multiId = null;
  await testAsync("Create assigned_users coupon [A,B,C] -> 201", async () => {
    const res = await http("POST", "/api/admin/coupons", adminJar, {
      code: multiCode, type: "fixed", value: 20000,
      eligibility: { mode: "assigned_users", assignedUsers: [userA._id.toString(), userB._id.toString(), userC._id.toString()], groups: [] },
    });
    assert(res.status === 201, "expected 201, got " + res.status);
    assert(res.data.eligibility.assignedUsers.length === 3, "expected 3 users");
    multiId = res.data._id;
  });

  // --- TEST: user_groups coupon → 201, groups stored lowercase ---
  const groupCode = PREFIX.toUpperCase() + "VIP";
  let groupId = null;
  await testAsync("Create user_groups coupon -> 201 (groups stored lowercase)", async () => {
    const res = await http("POST", "/api/admin/coupons", adminJar, {
      code: groupCode, type: "percent", value: 15,
      eligibility: { mode: "user_groups", assignedUsers: [], groups: ["VIP", "Premium"] },
    });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(res.data.eligibility.mode === "user_groups", "groups mode not persisted");
    assert(res.data.eligibility.groups.includes("vip") && res.data.eligibility.groups.includes("premium"), "groups must be lowercase: " + JSON.stringify(res.data.eligibility.groups));
    groupId = res.data._id;
  });

  // --- TEST: admin GET populates assignedUsers ---
  await testAsync("Admin GET populates assignedUsers (name/phone)", async () => {
    const res = await http("GET", "/api/admin/coupons", adminJar);
    assert(res.status === 200, "admin GET failed");
    const found = res.data.find((c) => c._id === singleId);
    assert(found, "created coupon missing from list");
    const u = found.eligibility.assignedUsers[0];
    assert(u && typeof u === "object" && u.name && u.phone, "assignedUsers must be populated objects with name/phone: " + JSON.stringify(u));
  });

  // --- TEST: validate is eligibility-aware ---
  await testAsync("Validate: non-assigned B -> 400 eligibility error; assigned A -> 200 rules", async () => {
    const nonElig = await http("POST", "/api/coupons/validate", customerBJar, { code: singleCode });
    assert(nonElig.status === 400, "non-assigned validate must be 400, got " + nonElig.status);
    assert(nonElig.data.error === ELIG_ERROR, "must return the DISTINCT eligibility error, got: " + nonElig.data.error);
    const elig = await http("POST", "/api/coupons/validate", customerAJar, { code: singleCode });
    assert(elig.status === 200 && elig.data.valid === true, "assigned user validate must be 200 valid");
  });

  // --- TEST: checkout by non-assigned → 400, no order, no claim ---
  const checkoutBody = {
    items: [{ id: prod1._id.toString(), quantity: 1, price: 100000, name: prod1.name }],
    shippingAddress: { fullName: "تست", phone: "09120000000", address: "تهران", postalCode: "1234567890" },
    paymentMethod: "manual",
  };
  await testAsync("Checkout by NON-assigned C -> 400 eligibility error, NO order, usedCount stays 0", async () => {
    const before = await db.collection("coupons").findOne({ _id: new mongoose.Types.ObjectId(singleId) });
    const res = await http("POST", "/api/checkout", customerCJar, { ...checkoutBody, couponCode: singleCode });
    assert(res.status === 400, "expected 400, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(res.data.error === ELIG_ERROR, "must return eligibility error, got: " + res.data.error);
    const order = await db.collection("orders").findOne({ "discount.code": singleCode });
    assert(!order, "no order may be created for a non-eligible user");
    const after = await db.collection("coupons").findOne({ _id: new mongoose.Types.ObjectId(singleId) });
    assert(after.usedCount === before.usedCount, "usedCount must stay " + before.usedCount + ", got " + after.usedCount);
    const usage = await db.collection("couponusages").findOne({ coupon: new mongoose.Types.ObjectId(singleId) });
    assert(!usage, "no coupon usage row may exist for a non-eligible user");
  });

  // --- TEST: checkout by assigned → 201 ---
  await testAsync("Checkout by ASSIGNED A -> 201 + discount", async () => {
    const res = await http("POST", "/api/checkout", customerAJar, { ...checkoutBody, couponCode: singleCode });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    const order = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(res.data.orderId) });
    assert(order.discount && order.discount.code === singleCode, "discount not applied");
    assert(order.discount.amount === 10000, "10% of 100000 = 10000, got " + order.discount.amount);
    assert(order.totalAmount === 90000, "payable must be 90000, got " + order.totalAmount);
  });

  // --- TEST: user_groups fail-closed ---
  await testAsync("user_groups coupon -> checkout by anyone -> 400 (fail-closed until groups exist)", async () => {
    const res = await http("POST", "/api/checkout", customerAJar, { ...checkoutBody, couponCode: groupCode });
    assert(res.status === 400, "expected 400, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(res.data.error === ELIG_ERROR, "group coupon must return eligibility error, got: " + res.data.error);
    const v = await http("POST", "/api/coupons/validate", customerAJar, { code: groupCode });
    assert(v.status === 400 && v.data.error === ELIG_ERROR, "validate must also be fail-closed for group coupons");
  });

  // --- TEST: public coupon (no eligibility) still works ---
  const pubCode = PREFIX.toUpperCase() + "PUB";
  let pubId = null;
  await testAsync("Public coupon (no eligibility) -> everyone eligible (backward compatible)", async () => {
    const created = await http("POST", "/api/admin/coupons", adminJar, { code: pubCode, type: "percent", value: 5 });
    assert(created.status === 201, "public create failed");
    assert(created.data.eligibility.mode === "public", "default mode must be public");
    pubId = created.data._id;
    const res = await http("POST", "/api/checkout", customerCJar, { ...checkoutBody, couponCode: pubCode });
    assert(res.status === 201, "public coupon checkout must succeed, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    const v = await http("POST", "/api/coupons/validate", customerBJar, { code: pubCode });
    assert(v.status === 200 && v.data.valid === true, "public coupon validate must succeed for any user");
  });

  // --- TEST: PUT reassign audience ---
  await testAsync("PUT reassigns audience [A] -> [B]: B eligible, A not", async () => {
    const upd = await http("PUT", "/api/admin/coupons/" + singleId, adminJar, {
      eligibility: { mode: "assigned_users", assignedUsers: [userB._id.toString()], groups: [] },
    });
    assert(upd.status === 200, "reassign PUT failed: " + upd.status + " " + JSON.stringify(upd.data).slice(0, 150));
    assert(upd.data.eligibility.assignedUsers.length === 1 && String(upd.data.eligibility.assignedUsers[0]) === String(userB._id), "audience not reassigned");
    const vB = await http("POST", "/api/coupons/validate", customerBJar, { code: singleCode });
    assert(vB.status === 200 && vB.data.valid === true, "B must now be eligible");
    const vA = await http("POST", "/api/coupons/validate", customerAJar, { code: singleCode });
    assert(vA.status === 400 && vA.data.error === ELIG_ERROR, "A must no longer be eligible");
  });

  // --- TEST: public list leak scan ---
  await testAsync("LEAK SCAN — eligibility/assignedUsers/groups/targetingRules never in the public list", async () => {
    const pub = await http("GET", "/api/coupons/public?page=1&limit=100", null);
    const keys = new Set();
    collectKeys(pub.data, keys);
    for (const leak of ["eligibility", "assignedUsers", "groups", "targetingRules", "mode", "usageLimit", "perUserLimit", "usedCount", "isPublic"]) {
      assert(!keys.has(leak), "LEAK: '" + leak + "' exposed in the public list");
    }
    console.log("\n      clean projection: " + [...keys].sort().join(", "));
  });

  // --- Cleanup own fixtures ---
  console.log("\nCleaning up test data...");
  // All coupon ids this suite created (claims were made on singleCode + pubCode)
  const ownedCouponIds = [singleId, multiId, groupId, pubId]
    .filter(Boolean)
    .map((id) => new mongoose.Types.ObjectId(id));
  await db.collection("coupons").deleteMany({ code: { $regex: "^" + PREFIX } });
  await db.collection("couponusages").deleteMany({ coupon: { $in: ownedCouponIds } });
  await db.collection("orders").deleteMany({ "discount.code": { $regex: "^" + PREFIX } });
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await Supplier.deleteMany({ _id: suppDoc._id });
  await User.deleteMany({ _id: { $in: [userA._id, userB._id, userC._id, suppUser._id] } });
  console.log("  Done");

  console.log("\n==================================================================");
  console.log("  RESULTS");
  console.log("==================================================================");
  console.log("  Total:   " + total);
  console.log("  Passed:  " + passed);
  console.log("  Failed:  " + failed);
  console.log("  Status:  " + (failed === 0 ? "ALL PASSED" : failed + " TEST(S) FAILED"));
  console.log("==================================================================");

  await mongoose.disconnect();
  if (failed > 0) process.exit(1);
}

run().catch((err) => { console.error("\nTest suite error:", err); process.exit(1); });
