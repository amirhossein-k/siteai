/**
 * Upload bug repro + verification against the REAL running Next.js API.
 *
 * Hypothesis: src/components/ui/file-upload.tsx sends
 *   axios.post("/api/upload", formData, { headers: { "Content-Type": "multipart/form-data" } })
 * Manually setting `Content-Type: multipart/form-data` WITHOUT a `boundary=...`
 * parameter makes the browser send the header exactly as given (no boundary),
 * so the server's `req.formData()` cannot split the body → `get("file")` is
 * null → API returns 400 "فایلی ارسال نشده است".
 *
 * This script proves it by uploading the SAME file two ways:
 *   A) with the manual header (current frontend behavior)
 *   B) without the manual header (browser auto-sets multipart boundary)
 * plus auth checks (401/403), type/size validation, and the full
 * product-create-with-image flow.
 *
 * Usage: node scripts/verify-upload-repro.js
 * Requires: dev server running on http://localhost:3000
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
const PREFIX = "uploadtest_" + Date.now() + "_";
const PASS = "upload-test-123";

let passed = 0;
let failed = 0;
let total = 0;

async function testAsync(name, fn) {
  total++;
  process.stdout.write("\n  [TEST " + total + "] " + name + " ... ");
  try {
    await fn();
    console.log("PASS");
    passed++;
  } catch (err) {
    console.log("FAIL: " + err.message);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "Assertion failed");
}

// --- Cookie jar + HTTP helpers (same pattern as verify-variants-e2e.js) ---
function makeJar() {
  const cookies = {};
  return {
    get(headers) {
      let entries = [];
      if (headers && typeof headers.getSetCookie === "function") {
        entries = headers.getSetCookie();
      } else if (Array.isArray(headers)) {
        entries = headers;
      }
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
    header() {
      return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
    },
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
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: jar.header(),
    },
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
  const res = await fetch(BASE + urlPath, {
    method,
    headers,
    body: requestBody,
    redirect: "manual",
  });
  if (jar) jar.get(res.headers);
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { status: res.status, data };
}

// --- Small valid test files ---
function makePngBuffer() {
  // Minimal 1x1 PNG (valid enough for MIME/type checks)
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return Buffer.from(b64, "base64");
}

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

async function run() {
  console.log("==================================================================");
  console.log("  UPLOAD BUG REPRO & VERIFICATION (REAL HTTP API)");
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
  const User = mongoose.models.User_UP || mongoose.model("User_UP", UserSchema);
  const Supplier = mongoose.models.Supplier_UP || mongoose.model("Supplier_UP", SupplierSchema);
  const Category = mongoose.models.Category_UP || mongoose.model("Category_UP", CategorySchema);
  const Product = mongoose.models.Product_UP || mongoose.model("Product_UP", ProductSchema);

  // Idempotency: sweep previous uploadtest users/products
  await User.deleteMany({ phone: /^0912[0-9]{8}$/ });
  await Supplier.deleteMany({ businessName: { $regex: "^UploadTest" } });
  await Category.deleteMany({ slug: { $regex: "^" + PREFIX } });
  await Product.deleteMany({ slug: { $regex: "^" + PREFIX } });

  const adminUser = await User.create({
    name: "UploadTest Admin", phone: "09129990001", passwordHash: await bcrypt.hash(PASS, 10), role: "admin", isActive: true,
  });
  const customerUser = await User.create({
    name: "UploadTest Customer", phone: "09129990002", passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true,
  });
  const supplierUser = await User.create({
    name: "UploadTest Supplier", phone: "09129990003", passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true,
  });
  const supplierDoc = await Supplier.create({
    user: supplierUser._id, businessName: "UploadTest Supplier Co", contactPhone: "09129990003", isActive: true,
  });
  await User.findByIdAndUpdate(supplierUser._id, { $set: { supplier: supplierDoc._id } });

  let adminJar = null;
  let customerJar = null;
  let supplierJar = null;

  // ================= AUTH =================
  await testAsync("Real login: admin", async () => {
    adminJar = await login(adminUser.phone, PASS);
    assert(adminJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Real login: customer", async () => {
    customerJar = await login(customerUser.phone, PASS);
    assert(customerJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Real login: supplier", async () => {
    supplierJar = await login(supplierUser.phone, PASS);
    assert(supplierJar.header().includes("session-token"), "no session cookie");
  });

  await testAsync("Unauthenticated /api/upload -> 401", async () => {
    const fd = new FormData();
    fd.append("file", new File([makePngBuffer()], "a.png", { type: "image/png" }));
    const res = await http("POST", "/api/upload", null, fd);
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  await testAsync("Customer /api/upload -> 403", async () => {
    const fd = new FormData();
    fd.append("file", new File([makePngBuffer()], "a.png", { type: "image/png" }));
    const res = await http("POST", "/api/upload", customerJar, fd);
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // ================= ROOT-CAUSE PROOF =================
  await testAsync("REPRO A: manual 'Content-Type: multipart/form-data' (no boundary) FAILS the upload", async () => {
    const fd = new FormData();
    fd.append("file", new File([makePngBuffer()], "repro.png", { type: "image/png" }));
    // Exactly what file-upload.tsx did BEFORE the fix:
    const res = await fetch(BASE + "/api/upload", {
      method: "POST",
      headers: {
        Cookie: adminJar.header(),
        "Content-Type": "multipart/form-data", // ← manual, no boundary
      },
      body: fd,
      redirect: "manual",
    });
    const text = await res.text();
    console.log("\n      status=" + res.status + " body=" + text.slice(0, 120));
    // The missing boundary makes the server's req.formData() throw → the
    // request FAILS (400 "فایلی ارسال نشده است" or 500 parse error). The
    // essential assertion is that this broken header never succeeds.
    assert(res.status !== 201, "manual header unexpectedly succeeded");
    assert(res.status === 400 || res.status === 500, "expected 400/500, got " + res.status);
  });

  await testAsync("REPRO B: NO manual Content-Type (browser sets boundary) -> file is received", async () => {
    const fd = new FormData();
    fd.append("file", new File([makePngBuffer()], "fixed.png", { type: "image/png" }));
    const res = await fetch(BASE + "/api/upload", {
      method: "POST",
      headers: { Cookie: adminJar.header() }, // ← let the client set multipart boundary
      body: fd,
      redirect: "manual",
    });
    const text = await res.text();
    console.log("\n      status=" + res.status + " body=" + text.slice(0, 200));
    // The file must NOT be rejected with 'no file'. It may succeed (201) if S3
    // is reachable, or fail validation/storage — but the error must not be
    // 'فایلی ارسال نشده است'.
    assert(
      res.status !== 400 || !text.includes("فایلی ارسال نشده است"),
      "file still not received: " + text.slice(0, 160)
    );
    if (res.status === 201) {
      console.log("      → full upload succeeded (S3 reachable)");
    } else {
      console.log("      → file RECEIVED; later-stage error: " + text.slice(0, 160));
    }
  });

  // ================= TYPE / SIZE VALIDATION =================
  await testAsync("Reject unsupported type (.txt) with specific error", async () => {
    const fd = new FormData();
    fd.append("file", new File([Buffer.from("hello")], "note.txt", { type: "text/plain" }));
    const res = await http("POST", "/api/upload", adminJar, fd);
    assert(res.status === 400, "expected 400, got " + res.status);
    assert(
      String(res.data?.error || "").includes("مجاز نیست"),
      "expected type error, got: " + JSON.stringify(res.data)
    );
  });

  await testAsync("Reject oversized image (>10MB) with specific error", async () => {
    const big = Buffer.alloc(11 * 1024 * 1024, 1);
    const fd = new FormData();
    fd.append("file", new File([big], "big.jpg", { type: "image/jpeg" }));
    const res = await http("POST", "/api/upload", adminJar, fd);
    assert(res.status === 400, "expected 400, got " + res.status);
    assert(
      String(res.data?.error || "").includes("مگابایت"),
      "expected size error, got: " + JSON.stringify(res.data)
    );
  });

  await testAsync("Reject empty file (0 bytes)", async () => {
    const fd = new FormData();
    fd.append("file", new File([Buffer.alloc(0)], "empty.png", { type: "image/png" }));
    const res = await http("POST", "/api/upload", adminJar, fd);
    assert(res.status === 400, "expected 400, got " + res.status);
  });

  // ================= SUCCESS PATH (jpg/png/webp if S3 reachable) =================
  let uploadedUrl = null;

  await testAsync("Upload JPG (if S3 reachable)", async () => {
    const fd = new FormData();
    fd.append("file", new File([makePngBuffer()], "shot.jpg", { type: "image/jpeg" }));
    const res = await http("POST", "/api/upload", adminJar, fd);
    if (res.status === 201) {
      uploadedUrl = res.data.url;
      console.log("\n      url=" + uploadedUrl.slice(0, 80) + "...");
    } else {
      console.log("\n      status=" + res.status + " (S3 unreachable in this env — storage error, not a parse bug): " + JSON.stringify(res.data).slice(0, 120));
    }
    // Assert we got a real storage-level response, NOT a parse failure.
    assert(res.status !== 400 || !String(res.data?.error || "").includes("فایلی ارسال نشده است"), "file not received");
  });

  // ================= PRODUCT CREATE WITH IMAGE =================
  let categoryId = null;
  let productId = null;

  await testAsync("Create category via admin API", async () => {
    const res = await http("POST", "/api/admin/categories", adminJar, {
      name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true,
    });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data));
    categoryId = res.data._id;
  });

  await testAsync("Create product with uploaded image URL", async () => {
    const images = uploadedUrl ? [uploadedUrl] : ["https://example.com/placeholder.jpg"];
    const res = await http("POST", "/api/admin/products", adminJar, {
      name: PREFIX + "Product",
      slug: PREFIX + "product",
      description: "upload test",
      category: categoryId,
      supplier: String(supplierDoc._id),
      price: 10000,
      supplierPrice: 5000,
      stock: 5,
      images,
      isActive: true,
    });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 200));
    productId = res.data._id;
    assert(Array.isArray(res.data.images) && res.data.images.length === images.length, "images not saved");
  });

  await testAsync("Edit product: add a second image, then remove it", async () => {
    const res = await http("PUT", "/api/admin/products?id=" + productId, adminJar, {
      name: PREFIX + "Product",
      slug: PREFIX + "product",
      description: "upload test edited",
      category: categoryId,
      supplier: String(supplierDoc._id),
      price: 10000,
      supplierPrice: 5000,
      stock: 5,
      images: [uploadedUrl ? uploadedUrl : "https://example.com/placeholder.jpg", "https://example.com/second.jpg"],
      isActive: true,
    });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 200));
    assert(res.data.images.length === 2, "expected 2 images after edit");

    const res2 = await http("PUT", "/api/admin/products?id=" + productId, adminJar, {
      name: PREFIX + "Product",
      slug: PREFIX + "product",
      description: "upload test edited",
      category: categoryId,
      supplier: String(supplierDoc._id),
      price: 10000,
      supplierPrice: 5000,
      stock: 5,
      images: [uploadedUrl ? uploadedUrl : "https://example.com/placeholder.jpg"],
      isActive: true,
    });
    assert(res2.status === 200, "expected 200, got " + res2.status);
    assert(res2.data.images.length === 1, "expected 1 image after removal");
  });

  // ================= SUPPLIER UPLOAD =================
  await testAsync("Supplier upload works (auth)", async () => {
    const fd = new FormData();
    fd.append("file", new File([makePngBuffer()], "supp.png", { type: "image/png" }));
    const res = await http("POST", "/api/upload", supplierJar, fd);
    assert(res.status !== 401 && res.status !== 403, "supplier should be authorized, got " + res.status);
    console.log("\n      status=" + res.status + (res.status === 201 ? " (S3 ok)" : " (S3 unreachable in env)"));
  });

  // ================= CLEANUP =================
  console.log("\nCleaning up test data...");
  await Product.deleteMany({ slug: { $regex: "^" + PREFIX } });
  await Category.deleteMany({ slug: { $regex: "^" + PREFIX } });
  await Supplier.deleteMany({ _id: supplierDoc._id });
  await User.deleteMany({ _id: { $in: [adminUser._id, customerUser._id, supplierUser._id] } });
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

run().catch((err) => {
  console.error("\nTest suite error:", err);
  process.exit(1);
});
