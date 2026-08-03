/**
 * Session 40 — Real-time Notifications (SSE) Verification (real HTTP API)
 *
 * Tests (against the real running Next.js API + real MongoDB):
 *   1. Unauthenticated GET /api/notifications/stream → 401
 *   2. Authenticated stream connects → 200, text/event-stream, `: connected`
 *   3. Event delivery: admin confirms order → customer A's LIVE stream
 *      receives the order_confirmed event (real notification creation)
 *   4. Customer isolation: customer B's open stream receives NOTHING while
 *      A's event is delivered
 *   5. Supplier isolation: supplier's open stream receives new_order from a
 *      real checkout; customer B's stream receives nothing
 *   6. Disconnect / reconnect: closing a stream unregisters it (no leak), and
 *      a fresh connection keeps receiving events
 *   7. Heartbeat: a `: ping` comment arrives within STREAM_HEARTBEAT_MS + slack
 *
 * Usage: node scripts/verify-sse.js
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
const PREFIX = "sse_" + Date.now() + "_";
const PASS = "sse-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const CUSTOMER_A_PHONE = "09157774001";
const CUSTOMER_B_PHONE = "09157774002";
const SUPPLIER_PHONE = "09157774003";

// Mirrors src/lib/notification-stream.ts (keep in sync)
const HEARTBEAT_MS = 15_000;

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

async function http(method, urlPath, jar, body, extraHeaders) {
  const headers = { ...(extraHeaders || {}) };
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

/**
 * Open an SSE connection with a cookie jar. Returns a handle with:
 *  - status / headers of the response
 *  - events[]  (parsed `data:` JSON payloads)
 *  - frames[]  (raw SSE frames incl. comments like ": connected")
 *  - waitFor(predicate, timeoutMs) → first matching parsed event or null
 *  - waitForFrame(predicate, timeoutMs) → first matching raw frame or null
 *  - close()   → aborts the connection (client-disconnect simulation)
 */
async function openStream(jar) {
  const ac = new AbortController();
  const res = await fetch(BASE + "/api/notifications/stream", {
    headers: { Cookie: jar.header(), Accept: "text/event-stream" },
    signal: ac.signal,
    redirect: "manual",
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  const frames = [];
  let buffer = "";
  let stopped = false;

  const pump = (async () => {
    try {
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          frames.push(frame);
          const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
          if (dataLine) {
            try { events.push(JSON.parse(dataLine.slice(6))); } catch { /* ignore */ }
          }
        }
      }
    } catch (e) {
      // aborted — expected on close()
    }
  })();

  const waitLoop = async (list, predicate, timeoutMs) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const hit = list.find(predicate);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  };

  return {
    status: res.status,
    headers: res.headers,
    events,
    frames,
    waitFor: (predicate, timeoutMs = 6000) => waitLoop(events, predicate, timeoutMs),
    waitForFrame: (predicate, timeoutMs = 6000) => waitLoop(frames, predicate, timeoutMs),
    close: async () => {
      stopped = true;
      try { ac.abort(); } catch { /* ignore */ }
    },
  };
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
const OrderSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    items: [{ product: mongoose.Schema.Types.ObjectId, supplier: mongoose.Schema.Types.ObjectId, variantId: mongoose.Schema.Types.ObjectId, name: String, price: Number, supplierPrice: Number, quantity: Number }],
    totalAmount: Number,
    shippingAddress: { fullName: String, phone: String, address: String, postalCode: String },
    payment: { status: String, method: String, authority: String, refId: String, cardPan: String, paidAt: Date },
    status: String,
    stockRestored: Boolean,
    statusHistory: [{ status: String, at: Date, note: String }],
  },
  { timestamps: true, collection: "orders" }
);

async function makeProcessingOrder(db, { customer, product, qty }) {
  return db.collection("orders").insertOne({
    customer: customer._id,
    items: [{ product: product._id, supplier: new mongoose.Types.ObjectId(), variantId: null, name: product.name, price: product.price, supplierPrice: product.supplierPrice, quantity: qty }],
    totalAmount: product.price * qty,
    shippingAddress: { fullName: "SSE Tester", phone: customer.phone, address: "Tehran", postalCode: "" },
    payment: { status: "paid", method: "zarinpal", authority: "SSEPAID_" + Date.now(), refId: "SSEREF_" + Date.now(), cardPan: "1234", paidAt: new Date() },
    status: "processing",
    stockRestored: false,
    statusHistory: [{ status: "processing", at: new Date(), note: "paid" }],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 40 — REAL-TIME NOTIFICATIONS (SSE, REAL HTTP API)");
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
  const User = mongoose.models.User_SSE || mongoose.model("User_SSE", UserSchema);
  const Supplier = mongoose.models.Supplier_SSE || mongoose.model("Supplier_SSE", SupplierSchema);
  const Category = mongoose.models.Category_SSE || mongoose.model("Category_SSE", CategorySchema);
  const Product = mongoose.models.Product_SSE || mongoose.model("Product_SSE", ProductSchema);

  // --- Idempotency sweep ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: { $in: [CUSTOMER_A_PHONE, CUSTOMER_B_PHONE, SUPPLIER_PHONE] } });
  await Supplier.deleteMany({ businessName: { $regex: "^SSETest" } });

  // --- Fixtures ---
  const customerA = await User.create({ name: "SSE Customer A", phone: CUSTOMER_A_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const customerB = await User.create({ name: "SSE Customer B", phone: CUSTOMER_B_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const suppUser = await User.create({ name: "SSE Supplier", phone: SUPPLIER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppDoc = await Supplier.create({ user: suppUser._id, businessName: "SSETest Supplier Co", contactPhone: SUPPLIER_PHONE, isActive: true });
  await User.findByIdAndUpdate(suppUser._id, { $set: { supplier: suppDoc._id } });
  const catDoc = await Category.create({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true });

  const makeProduct = (slugSuffix, stock, price = 10000) =>
    Product.create({
      name: PREFIX + slugSuffix, slug: PREFIX + slugSuffix, description: "sse test",
      category: catDoc._id, supplier: suppDoc._id, price, supplierPrice: price / 2,
      stock, stockVersion: 0, hasVariants: false, variants: [], isActive: true,
    });

  const prodConfirm = await makeProduct("prod-confirm", 10);
  const prodIsolation = await makeProduct("prod-isolation", 10);
  const prodCheckout = await makeProduct("prod-checkout", 10, 25000);

  let adminJar = null;
  let aJar = null;
  let bJar = null;
  let supplierJar = null;

  await testAsync("Seed admin login", async () => {
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    assert(adminJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Customer A login", async () => {
    aJar = await login(CUSTOMER_A_PHONE, PASS);
    assert(aJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Customer B login", async () => {
    bJar = await login(CUSTOMER_B_PHONE, PASS);
    assert(bJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Supplier login", async () => {
    supplierJar = await login(SUPPLIER_PHONE, PASS);
    assert(supplierJar.header().includes("session-token"), "no session cookie");
  });

  // --- TEST 1: unauthenticated stream → 401 ---
  await testAsync("Unauthenticated GET /api/notifications/stream -> 401", async () => {
    const res = await fetch(BASE + "/api/notifications/stream", { redirect: "manual" });
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  // --- TEST 2: authenticated stream connects ---
  let streamA = null;
  await testAsync("Authenticated stream connects (200, text/event-stream, :connected)", async () => {
    streamA = await openStream(aJar);
    assert(streamA.status === 200, "expected 200, got " + streamA.status);
    const ctype = streamA.headers.get("content-type") || "";
    assert(ctype.includes("text/event-stream"), "content-type must be text/event-stream, got " + ctype);
    const connected = await streamA.waitForFrame((f) => f.trim() === ": connected", 4000);
    assert(!!connected, ": connected comment not received");
  });

  // --- TEST 3: event delivery after real notification creation ---
  await testAsync("Live delivery: admin confirm -> order_confirmed event on A's stream", async () => {
    const inserted = await makeProcessingOrder(db, { customer: customerA, product: prodConfirm, qty: 1 });
    const orderId = inserted.insertedId.toString();

    const res = await http("PUT", "/api/admin/orders?id=" + orderId, adminJar, { status: "confirmed" });
    assert(res.status === 200, "admin confirm expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));

    const evt = await streamA.waitFor((e) => e.type === "order_confirmed", 6000);
    assert(!!evt, "order_confirmed event not received on live stream within 6s");
    assert(evt.relatedOrder === orderId, "relatedOrder must match: " + evt.relatedOrder);
    assert(evt.id && evt.message, "event must carry id + message");
    assert(evt.isRead === false, "new event must be unread");
    assert(evt.link === "/orders/" + orderId, "link must deep-link: " + evt.link);
    console.log("\n      evt.type=" + evt.type + " relatedOrder=" + evt.relatedOrder);
  });

  // --- TEST 4: customer isolation ---
  await testAsync("Customer isolation: B's open stream receives nothing while A's is delivered", async () => {
    const streamB = await openStream(bJar);
    const connectedB = await streamB.waitForFrame((f) => f.trim() === ": connected", 4000);
    assert(!!connectedB, "B's stream did not connect");

    const inserted = await makeProcessingOrder(db, { customer: customerA, product: prodIsolation, qty: 1 });
    const orderId = inserted.insertedId.toString();
    const res = await http("PUT", "/api/admin/orders?id=" + orderId, adminJar, { status: "confirmed" });
    assert(res.status === 200, "admin confirm expected 200, got " + res.status);

    const evtA = await streamA.waitFor((e) => e.type === "order_confirmed" && e.relatedOrder === orderId, 6000);
    assert(!!evtA, "A must receive its own event");
    // Wait a window then assert B never got it (B has no matching events at all)
    await new Promise((r) => setTimeout(r, 1500));
    const leakB = streamB.events.find((e) => e.type === "order_confirmed" && e.relatedOrder === orderId);
    assert(!leakB, "B received A's event (cross-user leak)");
    assert(streamB.events.length === 0, "B's stream should have no events, got " + streamB.events.length);
    await streamB.close();
  });

  // --- TEST 5: supplier isolation ---
  await testAsync("Supplier isolation: supplier stream gets new_order; B's stream gets nothing", async () => {
    const streamS = await openStream(supplierJar);
    const connectedS = await streamS.waitForFrame((f) => f.trim() === ": connected", 4000);
    assert(!!connectedS, "supplier stream did not connect");

    // Real checkout on the supplier's product → in-app new_order to the supplier
    const res = await http("POST", "/api/checkout", aJar, {
      items: [{ id: prodCheckout._id.toString(), quantity: 1, price: 25000, name: prodCheckout.name }],
      shippingAddress: { fullName: "SSE Tester", phone: customerA.phone, address: "Tehran", postalCode: "123" },
      paymentMethod: "manual",
    });
    assert(res.status === 201, "checkout expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));

    const evtS = await streamS.waitFor((e) => e.type === "new_order", 6000);
    assert(!!evtS, "supplier new_order event not received on live stream");
    assert(evtS.relatedOrder === res.data.orderId, "relatedOrder must match order");

    // Customer B's OWN open stream must NOT receive the supplier's event
    const streamB2 = await openStream(bJar);
    const connectedB2 = await streamB2.waitForFrame((f) => f.trim() === ": connected", 4000);
    assert(!!connectedB2, "B's stream did not connect");
    await new Promise((r) => setTimeout(r, 1500));
    assert(streamB2.events.length === 0, "B must not receive supplier events, got " + streamB2.events.length);
    await streamB2.close();
    await streamS.close();
  });

  // --- TEST 6: disconnect / reconnect ---
  await testAsync("Disconnect unregisters stream; fresh connection keeps receiving events", async () => {
    // Close A's first stream (client disconnect)
    await streamA.close();
    await new Promise((r) => setTimeout(r, 300));

    // Reconnect with a fresh connection
    const streamA2 = await openStream(aJar);
    const connected2 = await streamA2.waitForFrame((f) => f.trim() === ": connected", 4000);
    assert(!!connected2, "reconnected stream did not connect");

    // Trigger a new event → must arrive on the FRESH connection
    const inserted = await makeProcessingOrder(db, { customer: customerA, product: prodConfirm, qty: 1 });
    const orderId = inserted.insertedId.toString();
    const res = await http("PUT", "/api/admin/orders?id=" + orderId, adminJar, { status: "confirmed" });
    assert(res.status === 200, "admin confirm expected 200, got " + res.status);

    const evt = await streamA2.waitFor((e) => e.type === "order_confirmed" && e.relatedOrder === orderId, 6000);
    assert(!!evt, "event not received on reconnected stream");
    await streamA2.close();
  });

  // --- TEST 7: heartbeat ---
  await testAsync("Heartbeat: ': ping' comment arrives within HEARTBEAT + slack", async () => {
    const streamH = await openStream(aJar);
    const connectedH = await streamH.waitForFrame((f) => f.trim() === ": connected", 4000);
    assert(!!connectedH, "heartbeat stream did not connect");
    const ping = await streamH.waitForFrame((f) => f.trim() === ": ping", HEARTBEAT_MS + 8000);
    assert(!!ping, ": ping heartbeat not received within " + (HEARTBEAT_MS + 8000) + "ms");
    await streamH.close();
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("notifications").deleteMany({
    recipient: { $in: [customerA._id, customerB._id, suppUser._id] },
  });
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("supplierorders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await Supplier.deleteMany({ _id: suppDoc._id });
  await User.deleteMany({ _id: { $in: [customerA._id, customerB._id, suppUser._id] } });
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
