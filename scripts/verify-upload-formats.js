/**
 * Targeted format-verification for the upload fix (complements verify-upload-repro.js).
 *
 * Covers the gaps NOT exercised by verify-upload-repro.js:
 *   - PNG upload  -> 201 + real S3 URL
 *   - WEBP upload -> 201 + real S3 URL
 *   - Multi-image product create (JPG + PNG + WEBP in one product)
 *   - MongoDB persistence: product.images[] actually stored with the returned URLs
 *   - Product edit: add a 4th image, then remove one
 *   - Cleanup of created test data
 *
 * Requires: dev server on http://localhost:3000, real DB, S3/Liara env.
 * Usage:    node scripts/verify-upload-formats.js
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
const PREFIX = "fmtver_" + Date.now() + "_";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const SUPP_PHONE = "09137770001";
const SUPP_PASS = "fmt-ver-123";

// --- Minimal schemas (mirror repro script) for test-fixture creation ---
const UserSchema = new mongoose.Schema(
  { name: String, phone: String, passwordHash: String, role: String, supplier: { type: mongoose.Schema.Types.ObjectId, default: null }, isActive: Boolean },
  { timestamps: true, collection: "users" }
);
const SupplierSchema = new mongoose.Schema(
  { user: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, businessName: String, contactPhone: String, isActive: Boolean },
  { timestamps: true, collection: "suppliers" }
);

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

function makePngBuffer() {
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return Buffer.from(b64, "base64");
}
function makeWebpBuffer() {
  // Minimal valid RIFF/WEBP header
  return Buffer.from("UklGRiIAAABXRUJQVlA4ICQAAAAvAQAAAQ8AsAEhAIALAHwCAAAAAA==", "base64");
}
function makeJpegBuffer() {
  return Buffer.from("/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==", "base64");
}

async function run() {
  console.log("==================================================================");
  console.log("  UPLOAD FORMAT VERIFICATION (PNG / WEBP / MULTI-IMAGE / PERSISTENCE)");
  console.log("==================================================================");

  const uploadedUrls = []; // for cleanup via DELETE /api/upload

  try {
    const ping = await fetch(BASE + "/api/auth/csrf");
    assert(ping.status === 200, "dev server not reachable");
    console.log("\n  Dev server reachable\n");
  } catch {
    console.error("\nERROR: dev server not reachable. Start it with: npm run dev");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, { dbName: DB_NAME });
  const User = mongoose.models.User_FMT || mongoose.model("User_FMT", UserSchema);
  const Supplier = mongoose.models.Supplier_FMT || mongoose.model("Supplier_FMT", SupplierSchema);

  // Idempotency sweep + fixture setup
  await User.deleteMany({ phone: SUPP_PHONE });
  await Supplier.deleteMany({ businessName: { $regex: "^FmtVer" } });
  const suppUser = await User.create({
    name: "FmtVer Supplier", phone: SUPP_PHONE, passwordHash: await bcrypt.hash(SUPP_PASS, 10), role: "supplier", isActive: true,
  });
  const suppDoc = await Supplier.create({
    user: suppUser._id, businessName: "FmtVer Supplier Co", contactPhone: SUPP_PHONE, isActive: true,
  });
  await User.findByIdAndUpdate(suppUser._id, { $set: { supplier: suppDoc._id } });

  let adminJar = null;
  await testAsync("Seed admin login (09120000000)", async () => {
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    assert(adminJar.header().includes("session-token"), "no session cookie");
  });

  let categoryId = null;
  await testAsync("Create category via admin API", async () => {
    const res = await http("POST", "/api/admin/categories", adminJar, {
      name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true,
    });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    categoryId = res.data._id;
  });

  const uploaded = {};
  await testAsync("PNG upload -> 201 + S3 URL", async () => {
    const fd = new FormData();
    fd.append("file", new File([makePngBuffer()], "fmt-blue.png", { type: "image/png" }));
    const res = await http("POST", "/api/upload", adminJar, fd);
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(typeof res.data.url === "string" && res.data.url.startsWith("http"), "no URL returned");
    assert(res.data.key.startsWith("uploads/"), "unexpected key: " + res.data.key);
    uploaded.png = res.data.url;
    uploadedUrls.push(res.data.url);
    console.log("\n      url=" + res.data.url.slice(0, 90) + "...");
  });

  await testAsync("WEBP upload -> 201 + S3 URL", async () => {
    const fd = new FormData();
    fd.append("file", new File([makeWebpBuffer()], "fmt-green.webp", { type: "image/webp" }));
    const res = await http("POST", "/api/upload", adminJar, fd);
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(res.data.mimeType === "image/webp", "wrong mime: " + res.data.mimeType);
    uploaded.webp = res.data.url;
    uploadedUrls.push(res.data.url);
  });

  await testAsync("JPG upload -> 201 + S3 URL", async () => {
    const fd = new FormData();
    fd.append("file", new File([makeJpegBuffer()], "fmt-red.jpg", { type: "image/jpeg" }));
    const res = await http("POST", "/api/upload", adminJar, fd);
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(res.data.mimeType === "image/jpeg", "wrong mime: " + res.data.mimeType);
    uploaded.jpg = res.data.url;
    uploadedUrls.push(res.data.url);
  });

  let productId = null;
  await testAsync("Create product with 3 images (JPG+PNG+WEBP)", async () => {
    const res = await http("POST", "/api/admin/products", adminJar, {
      name: PREFIX + "Multi", slug: PREFIX + "multi", description: "format test",
      category: categoryId, supplier: String(suppDoc._id),
      price: 10000, supplierPrice: 5000, stock: 5, isActive: true,
      images: [uploaded.jpg, uploaded.png, uploaded.webp],
    });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 200));
    productId = res.data._id;
    assert(Array.isArray(res.data.images) && res.data.images.length === 3, "expected 3 images, got " + JSON.stringify(res.data.images));
  });

  await testAsync("MongoDB persistence: product.images[] = all 3 URLs", async () => {
    const doc = await mongoose.connection.db.collection("products").findOne({ _id: new mongoose.Types.ObjectId(productId) });
    assert(doc, "product not found in MongoDB");
    assert(Array.isArray(doc.images) && doc.images.length === 3, "MongoDB images wrong: " + JSON.stringify(doc.images));
    assert(doc.images.includes(uploaded.jpg) && doc.images.includes(uploaded.png) && doc.images.includes(uploaded.webp), "URLs don't match returned upload URLs");
    console.log("\n      stored=[" + doc.images.map((u) => u.split("/").pop()).join(", ") + "]");
  });

  await testAsync("Edit product: add 4th image", async () => {
    const res = await http("PUT", "/api/admin/products?id=" + productId, adminJar, {
      name: PREFIX + "Multi", slug: PREFIX + "multi", description: "format test",
      category: categoryId, supplier: String(suppDoc._id),
      price: 10000, supplierPrice: 5000, stock: 5, isActive: true,
      images: [uploaded.jpg, uploaded.png, uploaded.webp, uploaded.png],
    });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 200));
    assert(res.data.images.length === 4, "expected 4 images after add");
  });

  await testAsync("Edit product: remove one image", async () => {
    const res = await http("PUT", "/api/admin/products?id=" + productId, adminJar, {
      name: PREFIX + "Multi", slug: PREFIX + "multi", description: "format test",
      category: categoryId, supplier: String(suppDoc._id),
      price: 10000, supplierPrice: 5000, stock: 5, isActive: true,
      images: [uploaded.jpg, uploaded.webp],
    });
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.images.length === 2, "expected 2 images after removal");
  });

  // Cleanup (always runs, even on mid-run failure)
  try {
    console.log("\nCleaning up test data...");
    await mongoose.connection.db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
    await mongoose.connection.db.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
    if (suppDoc) await Supplier.deleteMany({ _id: suppDoc._id });
    if (suppUser) await User.deleteMany({ _id: suppUser._id });
    // Remove uploaded test objects from S3 + their File records via the real API
    for (const url of uploadedUrls) {
      try {
        const del = await http("DELETE", "/api/upload", adminJar, { key: url });
        if (del.status !== 200) console.warn("  cleanup DELETE status " + del.status + " for " + url.slice(0, 60));
      } catch (e) {
        console.warn("  cleanup DELETE failed:", (e && e.message) || "unknown");
      }
    }
    // Direct DB fallback: guarantee no test File records remain even if the
    // HTTP DELETE path (getKeyFromUrl) fails for env-specific reasons.
    await mongoose.connection.db
      .collection("files")
      .deleteMany({ url: { $in: uploadedUrls } });
    console.log("  Done");
  } catch (cleanupErr) {
    console.warn("  Cleanup partial failure:", cleanupErr.message);
  }

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
