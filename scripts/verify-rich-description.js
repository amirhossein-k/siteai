/**
 * Session 69 — Plate Rich Product Description Verification
 * (real HTTP API + real MongoDB)
 *
 * Tests:
 *   1.  Seed fixtures + logins (admin, supplier)
 *   2.  Unauthenticated POST with descriptionRich -> 401
 *   3.  Customer POST with descriptionRich -> 403
 *   4.  Admin creates product with a VALID rich tree -> 201; `description` is
 *       the derived plain-text projection; descriptionRich persisted
 *   5.  GET ?id= round-trip returns the exact descriptionRich tree
 *   6.  PUT updates descriptionRich + re-derives description
 *   7.  Legacy product (plain text only) -> no descriptionRich field
 *   8.  Legacy product edited WITHOUT descriptionRich -> description NOT erased
 *   9.  Unknown node type (script) -> 400
 *  10.  Unsafe link URL (javascript:/data:) -> 400
 *  11.  Unsafe image source (data:, foreign host) -> 400
 *  12.  Unknown properties (style/class/onclick) -> 400
 *  13.  Depth / node-count / serialized-size / leaf-length caps -> 400
 *  14.  Plain-text projection capped at 2000 chars
 *  15.  Supplier product route: same rich validation + auto-ownership
 *  16.  Public GET /api/products?slug= exposes descriptionRich (storefront)
 *  17.  Admin search finds the product via the derived plain-text description
 *  18.  Cleanup (fixtures removed)
 *
 * Usage: node scripts/verify-rich-description.js
 * Requires: dev server on http://localhost:3000, real DB, seeded admin.
 * NOTE: run suites sequentially — parallel verify scripts share the dev DB.
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
const PREFIX = "rich_" + Date.now() + "_";
const PASS = "rich-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const CUSTOMER_PHONE = "09158883011";
const SUPPLIER_PHONE = "09158883021";

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
  const init = { method, headers, redirect: "manual" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + urlPath, init);
  if (jar) jar.get(res.headers);
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: res.status, data };
}

// --- Minimal schemas (fixtures only; the API routes use the real models) ---
const UserSchema = new mongoose.Schema(
  { name: String, phone: String, passwordHash: String, role: String, supplier: { type: mongoose.Schema.Types.ObjectId, default: null }, isActive: Boolean, tokenVersion: Number },
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

async function run() {
  console.log("================================================================");
  console.log("  SESSION 69 — PLATE RICH PRODUCT DESCRIPTION (REAL HTTP API)");
  console.log("================================================================");

  try {
    const ping = await fetch(BASE + "/api/auth/csrf");
    assert(ping.status === 200, "dev server not reachable");
    console.log("\n  Dev server reachable\n");
  } catch {
    console.error("\nERROR: dev server not reachable. Start it with: npm run dev");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, { dbName: DB_NAME });
  const User = mongoose.models.User_RICH || mongoose.model("User_RICH", UserSchema);
  const Supplier = mongoose.models.Supplier_RICH || mongoose.model("Supplier_RICH", SupplierSchema);
  const Category = mongoose.models.Category_RICH || mongoose.model("Category_RICH", CategorySchema);

  // --- Idempotency sweep (re-runs must be clean) ---
  const fixturePhones = [CUSTOMER_PHONE, SUPPLIER_PHONE];
  await User.deleteMany({ phone: { $in: fixturePhones } });
  const fixtureUsers = await User.find({ phone: { $in: fixturePhones } }).select("_id").lean();
  const fixtureUserIds = fixtureUsers.map((u) => u._id);
  if (fixtureUserIds.length > 0) {
    await Supplier.deleteMany({ user: { $in: fixtureUserIds } });
  }
  // Any product/category left by an interrupted run.
  await mongoose.connection.db
    .collection("products")
    .deleteMany({ slug: { $regex: "^" + PREFIX } });
  await mongoose.connection.db
    .collection("categories")
    .deleteMany({ slug: PREFIX + "cat" });

  // --- Fixtures ---
  const customer = await User.create({
    name: "RICH Customer",
    phone: CUSTOMER_PHONE,
    passwordHash: await bcrypt.hash(PASS, 10),
    role: "customer",
    isActive: true,
    tokenVersion: 0,
  });
  const supplierUser = await User.create({
    name: "RICH Supplier",
    phone: SUPPLIER_PHONE,
    passwordHash: await bcrypt.hash(PASS, 10),
    role: "supplier",
    isActive: true,
    tokenVersion: 0,
  });
  const supplier = await Supplier.create({
    user: supplierUser._id,
    businessName: "فروشنده غنی " + PREFIX,
    contactPhone: SUPPLIER_PHONE,
    isActive: true,
  });
  const category = await Category.create({
    name: "دسته غنی " + PREFIX,
    slug: PREFIX + "cat",
    isActive: true,
  });

  let adminJar = null, customerJar = null, supplierJar = null;

  await testAsync("Seed logins (admin, customer, supplier)", async () => {
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    customerJar = await login(CUSTOMER_PHONE, PASS);
    supplierJar = await login(SUPPLIER_PHONE, PASS);
    assert(adminJar.header().includes("session-token"), "admin session missing");
    assert(supplierJar.header().includes("session-token"), "supplier session missing");
  });

  // --- TEST 2: unauth -> 401 ---
  await testAsync("Unauthenticated POST /api/admin/products with descriptionRich -> 401", async () => {
    const res = await http("POST", "/api/admin/products", null, {
      name: "x", slug: PREFIX + "unauth", category: String(category._id), supplier: String(supplier._id),
      price: 1000, supplierPrice: 500, stock: 5,
      descriptionRich: [{ type: "p", children: [{ text: "سلام" }] }],
    });
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  // --- TEST 3: customer -> 403 ---
  await testAsync("Customer POST /api/admin/products with descriptionRich -> 403", async () => {
    const res = await http("POST", "/api/admin/products", customerJar, {
      name: "x", slug: PREFIX + "customer", category: String(category._id), supplier: String(supplier._id),
      price: 1000, supplierPrice: 500, stock: 5,
      descriptionRich: [{ type: "p", children: [{ text: "سلام" }] }],
    });
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 4: admin creates a product with a valid rich tree ---
  const validRich = [
    { type: "h2", children: [{ text: "ویژگی‌های محصول" }] },
    {
      type: "p",
      children: [
        { text: "متن " },
        { text: "بولد", bold: true },
        { text: " و " },
        { text: "ایتالیک", italic: true },
      ],
    },
    {
      type: "ul",
      children: [
        { type: "li", children: [{ text: "آیتم اول" }] },
        { type: "li", children: [{ text: "آیتم دوم" }] },
      ],
    },
    {
      type: "a",
      url: "https://example.com/product",
      children: [{ text: "مشاهده جزئیات" }],
    },
    { type: "hr", children: [{ text: "" }] },
  ];
  let productId = null;
  await testAsync("Admin creates product with valid rich tree -> 201 (description derived)", async () => {
    const res = await http("POST", "/api/admin/products", adminJar, {
      name: "محصول غنی " + PREFIX,
      slug: PREFIX + "product",
      category: String(category._id),
      supplier: String(supplier._id),
      price: 250000,
      supplierPrice: 180000,
      stock: 8,
      description: "متن کهنه (باید جایگزین شود)",
      descriptionRich: validRich,
      images: [],
      isActive: true,
    });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 200));
    productId = res.data._id;
    // description must be the DERIVED plain-text projection (not the stale body value)
    assert(
      res.data.description.includes("ویژگی‌های محصول") && res.data.description.includes("آیتم اول") && res.data.description.includes("مشاهده جزئیات"),
      "derived description missing rich content: " + JSON.stringify(res.data.description)
    );
    assert(!res.data.description.includes("متن کهنه"), "stale plain-text body must be replaced");
    assert(Array.isArray(res.data.descriptionRich), "descriptionRich must persist on create");
    assert(res.data.descriptionRich.length === validRich.length, "rich tree must round-trip exactly");
  });

  // --- TEST 5: GET ?id= round-trip ---
  await testAsync("GET /api/admin/products?id= round-trips the exact rich tree", async () => {
    const res = await http("GET", "/api/admin/products?id=" + productId, adminJar);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(JSON.stringify(res.data.descriptionRich) === JSON.stringify(validRich), "rich tree must match byte-for-byte");
  });

  // --- TEST 6: PUT updates the rich tree + re-derives description ---
  const updatedRich = [
    { type: "h3", children: [{ text: "توضیح جدید" }] },
    {
      type: "ol",
      children: [
        { type: "li", children: [{ text: "مرحله یک" }] },
        { type: "li", children: [{ text: "مرحله دو" }] },
      ],
    },
  ];
  await testAsync("PUT updates descriptionRich + re-derives description", async () => {
    const res = await http("PUT", "/api/admin/products?id=" + productId, adminJar, {
      name: "محصول غنی " + PREFIX,
      slug: PREFIX + "product",
      category: String(category._id),
      supplier: String(supplier._id),
      price: 250000,
      supplierPrice: 180000,
      stock: 8,
      description: "متن کهنه",
      descriptionRich: updatedRich,
      images: [],
      isActive: true,
    });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 200));
    assert(res.data.description.includes("توضیح جدید") && res.data.description.includes("مرحله دو"), "description must be re-derived");
    assert(JSON.stringify(res.data.descriptionRich) === JSON.stringify(updatedRich), "rich tree must update");
  });

  // --- TEST 7: legacy plain-text product (no descriptionRich) ---
  await testAsync("Legacy product created with plain text only -> no descriptionRich", async () => {
    const res = await http("POST", "/api/admin/products", adminJar, {
      name: "محصول قدیمی " + PREFIX,
      slug: PREFIX + "legacy",
      category: String(category._id),
      supplier: String(supplier._id),
      price: 100000,
      supplierPrice: 70000,
      stock: 3,
      description: "توضیح متنی قدیمی",
      images: [],
      isActive: true,
    });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 200));
    assert(res.data.description === "توضیح متنی قدیمی", "legacy description must be preserved");
    assert(res.data.descriptionRich === undefined, "no descriptionRich on a legacy product");
  });

  // --- TEST 8: legacy product edited WITHOUT descriptionRich ---
  await testAsync("Legacy product edited without descriptionRich -> description NOT erased", async () => {
    const list = await http("GET", "/api/admin/products?search=" + encodeURIComponent(PREFIX + "legacy"), adminJar);
    const legacy = list.data.data.find((p) => p.slug === PREFIX + "legacy");
    assert(legacy, "legacy product must exist");

    const res = await http("PUT", "/api/admin/products?id=" + legacy._id, adminJar, {
      name: "محصول قدیمی " + PREFIX,
      slug: PREFIX + "legacy",
      category: String(category._id),
      supplier: String(supplier._id),
      price: 110000,
      supplierPrice: 70000,
      stock: 3,
      description: "توضیح متنی قدیمی",
      images: [],
      isActive: true,
    });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 200));
    assert(res.data.description === "توضیح متنی قدیمی", "description must survive a rich-less PUT");
    assert(res.data.descriptionRich === undefined, "still no descriptionRich");
  });

  // --- TEST 9: unknown node type ---
  await testAsync("Unknown node type (script) -> 400", async () => {
    const res = await http("POST", "/api/admin/products", adminJar, {
      name: "x", slug: PREFIX + "bad1", category: String(category._id), supplier: String(supplier._id),
      price: 1000, supplierPrice: 500, stock: 5,
      descriptionRich: [{ type: "script", children: [{ text: "alert(1)" }] }],
    });
    assert(res.status === 400, "expected 400, got " + res.status + " " + JSON.stringify(res.data));
  });

  // --- TEST 10: unsafe link URLs ---
  await testAsync("Unsafe link URLs (javascript:/data:) -> 400", async () => {
    for (const url of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "//evil.com/x"]) {
      const res = await http("POST", "/api/admin/products", adminJar, {
        name: "x", slug: PREFIX + "badlink_" + Math.random().toString(36).slice(2, 8), category: String(category._id), supplier: String(supplier._id),
        price: 1000, supplierPrice: 500, stock: 5,
        descriptionRich: [{ type: "a", url, children: [{ text: "لینک" }] }],
      });
      assert(res.status === 400, "url=" + url + " expected 400, got " + res.status);
    }
  });

  // --- TEST 11: unsafe image sources ---
  await testAsync("Unsafe image sources (data:/foreign host) -> 400", async () => {
    for (const url of ["data:image/png;base64,AAAA", "https://evil.example.com/x.png"]) {
      const res = await http("POST", "/api/admin/products", adminJar, {
        name: "x", slug: PREFIX + "badimg_" + Math.random().toString(36).slice(2, 8), category: String(category._id), supplier: String(supplier._id),
        price: 1000, supplierPrice: 500, stock: 5,
        descriptionRich: [{ type: "img", url, children: [{ text: "" }] }],
      });
      assert(res.status === 400, "url=" + url + " expected 400, got " + res.status);
    }
  });

  // --- TEST 12: unknown properties ---
  await testAsync("Unknown node properties (style/class/onclick) -> 400", async () => {
    const hostile = [
      {
        type: "p",
        children: [{ text: "x" }],
        style: "color:red;position:fixed",
      },
    ];
    const res = await http("POST", "/api/admin/products", adminJar, {
      name: "x", slug: PREFIX + "badprop", category: String(category._id), supplier: String(supplier._id),
      price: 1000, supplierPrice: 500, stock: 5,
      descriptionRich: hostile,
    });
    assert(res.status === 400, "expected 400, got " + res.status + " " + JSON.stringify(res.data));
  });

  // --- TEST 13: limits (depth / nodes / size / leaf length) ---
  await testAsync("Depth / node-count / serialized-size / leaf-length caps -> 400", async () => {
    // Depth
    const deepNode = { type: "p", children: [{ text: "x" }] };
    let cur = deepNode;
    for (let i = 0; i < 9; i++) cur = { type: "p", children: [cur] };
    let res = await http("POST", "/api/admin/products", adminJar, {
      name: "x", slug: PREFIX + "depth", category: String(category._id), supplier: String(supplier._id),
      price: 1000, supplierPrice: 500, stock: 5,
      descriptionRich: [cur],
    });
    assert(res.status === 400, "depth expected 400, got " + res.status);

    // Node count
    const manyNodes = Array.from({ length: 2001 }, () => ({ type: "p", children: [{ text: "x" }] }));
    res = await http("POST", "/api/admin/products", adminJar, {
      name: "x", slug: PREFIX + "nodes", category: String(category._id), supplier: String(supplier._id),
      price: 1000, supplierPrice: 500, stock: 5,
      descriptionRich: manyNodes,
    });
    assert(res.status === 400, "node-count expected 400, got " + res.status);

    // Serialized size
    res = await http("POST", "/api/admin/products", adminJar, {
      name: "x", slug: PREFIX + "size", category: String(category._id), supplier: String(supplier._id),
      price: 1000, supplierPrice: 500, stock: 5,
      descriptionRich: [{ type: "p", children: [{ text: "x".repeat(70 * 1024) }] }],
    });
    assert(res.status === 400, "size expected 400, got " + res.status);

    // Leaf length
    res = await http("POST", "/api/admin/products", adminJar, {
      name: "x", slug: PREFIX + "leaf", category: String(category._id), supplier: String(supplier._id),
      price: 1000, supplierPrice: 500, stock: 5,
      descriptionRich: [{ type: "p", children: [{ text: "x".repeat(2001) }] }],
    });
    assert(res.status === 400, "leaf expected 400, got " + res.status);
  });

  // --- TEST 14: 2000-char projection cap ---
  // NOTE: each LEAF is capped at 2000 chars individually (leaf-length cap), so
  // the projection cap must be exercised with multiple leaves whose total
  // exceeds 2000 while each stays under the per-leaf limit.
  await testAsync("Plain-text projection capped at 2000 chars", async () => {
    const res = await http("POST", "/api/admin/products", adminJar, {
      name: "x", slug: PREFIX + "cap", category: String(category._id), supplier: String(supplier._id),
      price: 1000, supplierPrice: 500, stock: 5,
      descriptionRich: [
        { type: "p", children: [{ text: "a".repeat(1500) }, { text: "b".repeat(1500) }] },
      ],
    });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 200));
    assert(res.data.description.length === 2000, "must be exactly 2000 chars, got " + res.data.description.length);
  });

  // --- TEST 15: supplier route — same validation + auto-ownership ---
  await testAsync("Supplier creates product with rich tree -> 201 (auto-owned, derived description)", async () => {
    const res = await http("POST", "/api/supplier/products", supplierJar, {
      name: "محصول فروشنده " + PREFIX,
      slug: PREFIX + "supplier-product",
      category: String(category._id),
      price: 300000,
      supplierPrice: 200000,
      stock: 4,
      descriptionRich: [
        { type: "h3", children: [{ text: "جزئیات از فروشنده" }] },
        { type: "p", children: [{ text: "توضیح فروشنده" }] },
      ],
      images: [],
      isActive: true,
    });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 200));
    // supplier is POPULATED ({_id, businessName}) in the create response
    assert(
      res.data.supplier && String(res.data.supplier._id || res.data.supplier) === String(supplier._id),
      "supplier must auto-own the product"
    );
    assert(res.data.description.includes("جزئیات از فروشنده"), "derived description expected");
  });

  // Supplier hostile payload must be rejected too (same gate).
  await testAsync("Supplier hostile rich payload -> 400 (same gate)", async () => {
    const res = await http("POST", "/api/supplier/products", supplierJar, {
      name: "x", slug: PREFIX + "supplier-bad", category: String(category._id),
      price: 1000, supplierPrice: 500, stock: 5,
      descriptionRich: [{ type: "script", children: [{ text: "alert(1)" }] }],
    });
    assert(res.status === 400, "expected 400, got " + res.status + " " + JSON.stringify(res.data));
  });

  // --- TEST 16: public storefront exposes descriptionRich ---
  await testAsync("Public GET /api/products?slug= exposes descriptionRich (storefront contract)", async () => {
    const res = await http("GET", "/api/products?slug=" + PREFIX + "product", null);
    assert(res.status === 200, "expected 200, got " + res.status);
    const product = res.data;
    assert(Array.isArray(product.descriptionRich), "descriptionRich must be public");
    assert(JSON.stringify(product.descriptionRich) === JSON.stringify(updatedRich), "public rich tree must match");
    assert(product.description.includes("توضیح جدید"), "derived description must be public");
  });

  // --- TEST 17: search finds via derived plain-text description ---
  await testAsync("Admin search finds the product via derived plain-text description", async () => {
    const res = await http("GET", "/api/admin/products?search=" + encodeURIComponent("توضیح جدید"), adminJar);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(
      res.data.data.some((p) => p.slug === PREFIX + "product"),
      "search must match the derived description text"
    );
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await mongoose.connection.db
    .collection("products")
    .deleteMany({ slug: { $regex: "^" + PREFIX } });
  await Category.deleteMany({ _id: category._id });
  await Supplier.deleteMany({ _id: supplier._id });
  await User.deleteMany({ _id: { $in: [customer._id, supplierUser._id] } });
  console.log("  Done");

  console.log("\n================================================================");
  console.log("  RESULTS");
  console.log("================================================================");
  console.log("  Total:   " + total);
  console.log("  Passed:  " + passed);
  console.log("  Failed:  " + failed);
  console.log("  Status:  " + (failed === 0 ? "ALL PASSED" : failed + " TEST(S) FAILED"));
  console.log("================================================================");

  await mongoose.disconnect();
  if (failed > 0) process.exit(1);
}

run().catch((err) => { console.error("\nTest suite error:", err); process.exit(1); });
