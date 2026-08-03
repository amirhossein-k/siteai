/**
 * Session 31 — Variant Polish Verification (real HTTP API)
 *
 * Tests (against the real running Next.js API + real MongoDB):
 *   1. Variant order display data — checkout a variant product, verify the
 *      order item snapshot carries variantLabel + sku + image (immutable)
 *   2. Old-order compatibility — orders without variant snapshots still render
 *   3. Supplier quick-edit own variant stock → 200, stock + summary updated
 *   4. Supplier cannot edit another supplier's variant → 404
 *   5. Invalid variantId / negative stock → 400
 *   6. stockVersion optimistic lock — concurrent quick-edits: exactly one wins
 *   7. Simple products remain compatible — quick-edit rejected on simple
 *      products (400) + simple-product checkout still works
 *
 * Usage: node scripts/verify-variant-polish.js
 * Requires: dev server on http://localhost:3000, real DB.
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
const PREFIX = "polish_" + Date.now() + "_";
const PASS = "polish-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const SUPP_A_PHONE = "09138890001";
const SUPP_B_PHONE = "09138890002";
const CUSTOMER_PHONE = "09138890003";

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
  if (body !== undefined && !(body instanceof FormData)) {
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

// --- Minimal schemas (fixtures only; API routes use the real models) ---
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
const OrderSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    items: [{ product: mongoose.Schema.Types.ObjectId, supplier: mongoose.Schema.Types.ObjectId, variantId: mongoose.Schema.Types.ObjectId, sku: String, variantLabel: String, image: String, name: String, price: Number, supplierPrice: Number, quantity: Number }],
    totalAmount: Number,
    shippingAddress: { fullName: String, phone: String, address: String, postalCode: String },
    payment: { status: String, method: String, authority: String, refId: String, cardPan: String, paidAt: Date },
    status: String,
    stockRestored: Boolean,
    statusHistory: [{ status: String, at: Date, note: String }],
  },
  { timestamps: true, collection: "orders" }
);

const variantWith = (suffix, sku, price, stock, stockVersion, color) => ({
  _id: new mongoose.Types.ObjectId(), // Mixed arrays don't auto-generate _id
  sku,
  attributes: [{ attributeId: new mongoose.Types.ObjectId(), name: "رنگ", value: color }],
  price,
  supplierPrice: price / 2,
  stock,
  stockVersion,
  images: ["https://cdn.example.com/variant-" + suffix + ".jpg"],
  isActive: true,
});

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 31 — VARIANT POLISH (REAL HTTP API)");
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
  const User = mongoose.models.User_POLISH || mongoose.model("User_POLISH", UserSchema);
  const Supplier = mongoose.models.Supplier_POLISH || mongoose.model("Supplier_POLISH", SupplierSchema);
  const Category = mongoose.models.Category_POLISH || mongoose.model("Category_POLISH", CategorySchema);
  const Product = mongoose.models.Product_POLISH || mongoose.model("Product_POLISH", ProductSchema);

  // --- Idempotency sweep ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: { $in: [SUPP_A_PHONE, SUPP_B_PHONE, CUSTOMER_PHONE] } });
  await Supplier.deleteMany({ businessName: { $regex: "^Polish" } });

  // --- Fixtures ---
  const suppAUser = await User.create({ name: "Polish Supplier A", phone: SUPP_A_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppBUser = await User.create({ name: "Polish Supplier B", phone: SUPP_B_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const customer = await User.create({ name: "Polish Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const suppA = await Supplier.create({ user: suppAUser._id, businessName: "Polish Supplier A Co", contactPhone: SUPP_A_PHONE, isActive: true });
  const suppB = await Supplier.create({ user: suppBUser._id, businessName: "Polish Supplier B Co", contactPhone: SUPP_B_PHONE, isActive: true });
  await User.findByIdAndUpdate(suppAUser._id, { $set: { supplier: suppA._id } });
  await User.findByIdAndUpdate(suppBUser._id, { $set: { supplier: suppB._id } });
  const cat = await Category.create({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true });

  // Variant product owned by supplier A (two variants, stock 10 + 5 = summary 15)
  const prodVarA = await Product.create({
    name: PREFIX + "Shirt A", slug: PREFIX + "shirt-a", description: "polish",
    images: ["https://cdn.example.com/product-a.jpg"], category: cat._id, supplier: suppA._id,
    supplierPrice: 0, price: 5000, stock: 15, stockVersion: 0,
    hasVariants: true,
    variants: [variantWith("a1", "POLISH-A-RED", 5000, 10, 0, "قرمز"), variantWith("a2", "POLISH-A-BLUE", 5500, 5, 0, "آبی")],
    isActive: true,
  });
  // Variant product owned by supplier B (one variant, stock 7)
  const prodVarB = await Product.create({
    name: PREFIX + "Shirt B", slug: PREFIX + "shirt-b", description: "polish",
    images: [], category: cat._id, supplier: suppB._id,
    supplierPrice: 0, price: 6000, stock: 7, stockVersion: 0,
    hasVariants: true,
    variants: [variantWith("b1", "POLISH-B-GREEN", 6000, 7, 0, "سبز")],
    isActive: true,
  });
  // Simple product owned by supplier A (stock 20)
  const prodSimple = await Product.create({
    name: PREFIX + "Simple", slug: PREFIX + "simple", description: "polish",
    images: ["https://cdn.example.com/simple.jpg"], category: cat._id, supplier: suppA._id,
    supplierPrice: 1000, price: 3000, stock: 20, stockVersion: 0,
    hasVariants: false, variants: [], isActive: true,
  });

  let adminJar = null, aJar = null, bJar = null, cJar = null;

  await testAsync("Seed admin login", async () => {
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    assert(adminJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Supplier A login", async () => {
    aJar = await login(SUPP_A_PHONE, PASS);
    assert(aJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Supplier B login", async () => {
    bJar = await login(SUPP_B_PHONE, PASS);
    assert(bJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Customer login", async () => {
    cJar = await login(CUSTOMER_PHONE, PASS);
    assert(cJar.header().includes("session-token"), "no session cookie");
  });

  // --- TEST 1: variant order display data ---
  const v1 = prodVarA.variants[0]; // قرمز 5000, stock 10
  let orderId = null;
  await testAsync("Variant order snapshot carries variantLabel + sku + image", async () => {
    const res = await http("POST", "/api/checkout", cJar, {
      items: [{ id: String(prodVarA._id), variantId: String(v1._id), quantity: 2, price: 5000, name: prodVarA.name }],
      shippingAddress: { fullName: "Polish Customer", phone: CUSTOMER_PHONE, address: "Tehran", postalCode: "" },
      paymentMethod: "manual",
    });
    assert(res.status === 201, "checkout expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    orderId = res.data.orderId;

    const orderRes = await http("GET", "/api/orders?id=" + orderId, cJar);
    assert(orderRes.status === 200, "order fetch expected 200, got " + orderRes.status);
    const order = orderRes.data;
    const item = order.items?.[0];
    assert(item, "order has no items");
    assert(item.variantLabel && item.variantLabel.includes("رنگ"), "missing variantLabel, got: " + JSON.stringify(item.variantLabel));
    assert(item.sku === "POLISH-A-RED", "missing sku, got: " + item.sku);
    assert(item.image === "https://cdn.example.com/variant-a1.jpg", "missing variant image snapshot, got: " + item.image);
    console.log("\n      label=" + item.variantLabel + " sku=" + item.sku + " image=" + item.image.slice(-20));
  });

  // --- TEST 2: old orders without variant snapshots still render ---
  await testAsync("Old order without variant fields renders (compat)", async () => {
    const legacy = await db.collection("orders").insertOne({
      customer: customer._id,
      items: [{ product: prodSimple._id, supplier: suppA._id, name: prodSimple.name, price: 3000, supplierPrice: 1000, quantity: 1 }],
      totalAmount: 3000,
      shippingAddress: { fullName: "Polish Customer", phone: CUSTOMER_PHONE, address: "Tehran", postalCode: "" },
      payment: { status: "paid", method: "manual", authority: "", refId: "LEGACY", cardPan: "", paidAt: new Date() },
      status: "processing", stockRestored: true,
      statusHistory: [{ status: "pending_payment", at: new Date(), note: "legacy" }],
      createdAt: new Date(), updatedAt: new Date(),
    });
    const res = await http("GET", "/api/orders?id=" + String(legacy.insertedId), cJar);
    assert(res.status === 200, "legacy order fetch expected 200, got " + res.status);
    const item = res.data.items?.[0];
    assert(item && item.name === prodSimple.name, "legacy item missing");
    assert(item.variantLabel === undefined || item.variantLabel === "", "legacy order should have no variantLabel");
    console.log("\n      legacy item renders (no variant fields)");
  });

  // --- TEST 3: supplier A quick-edit own variant stock ---
  // NOTE: TEST 1's checkout already reserved 2 of the red variant (10->8) and
  // decremented the summary (15->13), so the baseline here is 13 (8 red + 5 blue).
  const v2 = prodVarA.variants[1]; // آبی 5500, stock 5
  await testAsync("Supplier quick-edit own variant stock -> 200 + summary synced", async () => {
    const res = await http("POST", "/api/supplier/products/stock", aJar, {
      productId: String(prodVarA._id), variantId: String(v2._id), stock: 25,
    });
    assert(res.status === 200, "quick-edit expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    const updatedVariant = res.data.variants?.find((x) => String(x._id) === String(v2._id));
    assert(updatedVariant && updatedVariant.stock === 25, "variant stock not updated, got " + JSON.stringify(updatedVariant));
    // summary = 8 (red, post-checkout) + 25 (blue) = 33
    assert(res.data.stock === 33, "summary stock should be 33, got " + res.data.stock);
    console.log("\n      variant stock 5->25, summary 13->" + res.data.stock);
  });

  // --- TEST 4: supplier cannot edit another supplier's variant ---
  await testAsync("Supplier B cannot edit Supplier A's variant -> 404", async () => {
    const res = await http("POST", "/api/supplier/products/stock", bJar, {
      productId: String(prodVarA._id), variantId: String(v1._id), stock: 99,
    });
    assert(res.status === 404, "expected 404, got " + res.status + " " + JSON.stringify(res.data).slice(0, 100));
  });

  // --- TEST 5: invalid variant / negative stock -> 400 ---
  await testAsync("Invalid variantId -> 400", async () => {
    const res = await http("POST", "/api/supplier/products/stock", aJar, {
      productId: String(prodVarA._id), variantId: new mongoose.Types.ObjectId().toString(), stock: 5,
    });
    assert(res.status === 400, "expected 400, got " + res.status);
  });
  await testAsync("Negative stock -> 400", async () => {
    const res = await http("POST", "/api/supplier/products/stock", aJar, {
      productId: String(prodVarA._id), variantId: String(v1._id), stock: -3,
    });
    assert(res.status === 400, "expected 400, got " + res.status);
  });

  // --- TEST 6: stockVersion optimistic lock — concurrent edits: exactly one wins ---
  await testAsync("Concurrent quick-edits -> exactly one 200 + one 409 (stockVersion)", async () => {
    const [r1, r2] = await Promise.all([
      http("POST", "/api/supplier/products/stock", aJar, {
        productId: String(prodVarA._id), variantId: String(v1._id), stock: 100,
      }),
      http("POST", "/api/supplier/products/stock", aJar, {
        productId: String(prodVarA._id), variantId: String(v1._id), stock: 200,
      }),
    ]);
    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    assert(statuses[0] === 200 && statuses[1] === 409, "expected [200,409], got " + JSON.stringify(statuses));
    // Final stock = the winner's value (100 or 200), never a mix / negative
    const doc = await db.collection("products").findOne({ _id: prodVarA._id });
    const winnerVariant = doc.variants.find((x) => String(x._id) === String(v1._id));
    assert([100, 200].includes(winnerVariant.stock), "stock must equal a winner value, got " + winnerVariant.stock);
    console.log("\n      statuses=" + JSON.stringify(statuses) + " final stock=" + winnerVariant.stock);
  });

  // --- TEST 7: simple products remain compatible ---
  await testAsync("Quick-edit rejected on simple product -> 400", async () => {
    const res = await http("POST", "/api/supplier/products/stock", aJar, {
      productId: String(prodSimple._id), variantId: new mongoose.Types.ObjectId().toString(), stock: 5,
    });
    assert(res.status === 400, "expected 400, got " + res.status + " " + JSON.stringify(res.data).slice(0, 80));
  });
  await testAsync("Simple product checkout still works (compat)", async () => {
    const res = await http("POST", "/api/checkout", cJar, {
      items: [{ id: String(prodSimple._id), quantity: 1, price: 3000, name: prodSimple.name }],
      shippingAddress: { fullName: "Polish Customer", phone: CUSTOMER_PHONE, address: "Tehran", postalCode: "" },
      paymentMethod: "manual",
    });
    assert(res.status === 201, "simple checkout expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await Supplier.deleteMany({ _id: { $in: [suppA._id, suppB._id] } });
  await User.deleteMany({ _id: { $in: [suppAUser._id, suppBUser._id, customer._id] } });
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
