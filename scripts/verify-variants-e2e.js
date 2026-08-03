/**
 * Attributes & Product Variants — END-TO-END Verification (real HTTP API)
 *
 * Unlike verify-variants.js (which inlines algorithms), this script hits the
 * REAL running Next.js API routes over HTTP with REAL NextAuth session cookies:
 *
 *   1. Real login (admin / supplier / customer) via /api/auth/csrf +
 *      /api/auth/callback/credentials
 *   2. Create Attribute + Category via admin API
 *   3. Create + edit a variant product via admin API
 *   4. SKU uniqueness through the real admin + supplier product APIs (409)
 *   5. MongoDB unique-index protection (direct insert → E11000)
 *   6. Concurrent variant checkout via /api/checkout (stock=1, 2 parallel → 1 wins)
 *   7. Simple product checkout regression via /api/checkout
 *   8. Payment cancel (Status=NOK) → variant stock restored exactly once
 *   9. Failed payment (bogus authority) → variant stock restored exactly once
 *  10. Already-paid guard → no double restore on success path
 *  11. Admin order cancellation → variant stock restored
 *  12. Pagination response shape on /api/products
 *  13. Unauthenticated → 401, wrong role → 403 on real routes
 *
 * Creates a "demo" variant product (kept at the end, URL printed) so the
 * storefront variant selector can be verified in a browser afterwards.
 * Pass --cleanup-demo to also delete the demo product.
 *
 * Usage: node scripts/verify-variants-e2e.js [--cleanup-demo]
 * Requires: dev server running on http://localhost:3000
 */

const fs = require("fs");
const path = require("path");

// Load .env.local manually (for direct MongoDB seeding)
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
const CLEANUP_DEMO = process.argv.includes("--cleanup-demo");
const TEST_PREFIX = "e2e_" + Date.now() + "_";
const DEMO_PREFIX = "e2edemo_";
const DEMO_SLUG = DEMO_PREFIX + Date.now();

let passed = 0;
let failed = 0;
let totalTests = 0;

async function testAsync(name, fn) {
  totalTests++;
  process.stdout.write("\n  [TEST " + totalTests + "] " + name + " ... ");
  try {
    await fn();
    console.log("PASS");
    passed++;
  } catch (err) {
    console.log("FAIL: " + err.message);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

// ---------------------------------------------------------------------------
// Cookie jar + HTTP helpers
// ---------------------------------------------------------------------------
function makeJar() {
  const cookies = {};
  return {
    /** Parse Set-Cookie entries (raw strings or a Headers object).
     *  NOTE: must use getSetCookie() — a single set-cookie header string is
     *  ambiguous and NextAuth cookie names (next-auth.session-token) contain
     *  hyphens/dots that break naive comma-splitting. */
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
      return Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    },
  };
}

async function http(method, urlPath, jar, body) {
  const headers = {};
  if (jar) headers.Cookie = jar.header();
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + urlPath, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  if (jar) jar.get(res.headers);
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, data, location: res.headers.get("location") };
}

async function login(phone, password) {
  const jar = makeJar();
  // 1. CSRF
  let res = await fetch(BASE + "/api/auth/csrf");
  jar.get(res.headers);
  const csrfBody = await res.json();
  const csrfToken = csrfBody.csrfToken;

  // 2. Credentials callback (JSON mode)
  const form = new URLSearchParams({
    csrfToken,
    phone,
    password,
    json: "true",
  });
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

// ---------------------------------------------------------------------------
// Inline schemas (direct seeding only — mirrors real models)
// ---------------------------------------------------------------------------
const ProductVariantSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, trim: true, uppercase: true, maxlength: 64 },
    attributes: [
      {
        attributeId: { type: mongoose.Schema.Types.ObjectId, ref: "Attribute", required: true },
        name: { type: String, required: true },
        value: { type: String, required: true },
      },
      { _id: false },
    ],
    price: { type: Number, required: true, min: 0 },
    supplierPrice: { type: Number, required: true, min: 0 },
    stock: { type: Number, default: 0, min: 0 },
    stockVersion: { type: Number, default: 0 },
    images: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { _id: true }
);

const ProductSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, default: "" },
    images: { type: [String], default: [] },
    brand: { type: mongoose.Schema.Types.ObjectId, ref: "Brand", default: null },
    tags: { type: [mongoose.Schema.Types.ObjectId], ref: "Tag", default: [] },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    supplierPrice: { type: Number, required: true, min: 0 },
    price: { type: Number, required: true, min: 0 },
    stock: { type: Number, default: 0, min: 0 },
    stockVersion: { type: Number, default: 0 },
    hasVariants: { type: Boolean, default: false },
    variants: { type: [ProductVariantSchema], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "products" }
);

const OrderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
    sku: { type: String, default: "" },
    variantLabel: { type: String, default: "" },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    supplierPrice: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const OrderSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    items: { type: [OrderItemSchema], required: true },
    totalAmount: { type: Number, required: true, min: 0 },
    shippingAddress: { fullName: String, phone: String, address: String, postalCode: String },
    payment: {
      status: { type: String, enum: ["pending", "paid", "failed", "canceled", "refunded"], default: "pending" },
      method: { type: String, enum: ["zarinpal", "manual"], default: "zarinpal" },
      authority: { type: String, default: "" },
      refId: { type: String, default: "" },
      cardPan: { type: String, default: "" },
      paidAt: { type: Date, default: null },
    },
    status: {
      type: String,
      enum: ["pending_payment", "processing", "confirmed", "shipped", "delivered", "cancelled"],
      default: "pending_payment",
    },
    stockRestored: { type: Boolean, default: false },
    statusHistory: [{ status: String, at: { type: Date, default: Date.now }, note: String }],
  },
  { timestamps: true, collection: "orders" }
);

const SupplierSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    businessName: { type: String, required: true, trim: true },
    contactPhone: { type: String, required: true },
    bankAccount: { cardNumber: String, iban: String, ownerName: String },
    telegramChatId: { type: String, default: "" },
    balance: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "suppliers" }
);

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["customer", "supplier", "admin"], default: "customer" },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", default: null },
    address: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "users" }
);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run() {
  console.log("==================================================================");
  console.log("  ATTRIBUTES & VARIANTS — E2E VERIFICATION (REAL HTTP API)");
  console.log("==================================================================");

  if (!process.env.MONGODB_URI) {
    console.error("\nERROR: MONGODB_URI not found. Check .env.local");
    process.exit(1);
  }

  // Ping the dev server
  try {
    const ping = await fetch(BASE + "/api/auth/csrf");
    assert(ping.status === 200, "dev server not reachable at " + BASE);
    console.log("\n  Dev server reachable at " + BASE + "\n");
  } catch (e) {
    console.error("\nERROR: dev server not reachable. Start it with: npm run dev");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, { dbName: DB_NAME });

  const Product = mongoose.models.Product_E2E || mongoose.model("Product_E2E", ProductSchema);
  const Order = mongoose.models.Order_E2E || mongoose.model("Order_E2E", OrderSchema);
  const Supplier = mongoose.models.Supplier_E2E || mongoose.model("Supplier_E2E", SupplierSchema);
  const User = mongoose.models.User_E2E || mongoose.model("User_E2E", UserSchema);

  // --- Idempotency: clean leftovers from ANY previous crashed run ---
  // NOTE: must run BEFORE createIndex below — if a crashed prior run ever left
  // two docs with the same variant SKU, ensuring the unique index would fail
  // with a duplicate-key error and crash the script instead of sweeping first.
  // TEST_PREFIX embeds a timestamp, so sweep stable prefixes instead:
  // fixed test phone numbers, supplier business name, ^e2e_ slugs, and
  // the orders/supplier-orders of the fixed test customers.
  const fixedPhones = ["09121110001", "09121110002", "09121110003"];
  const staleUsers = await User.find({ phone: { $in: fixedPhones } }, "_id").lean();
  const staleUserIds = staleUsers.map((u) => u._id);
  if (staleUserIds.length > 0) {
    const staleOrderIds = await Order.find({ customer: { $in: staleUserIds } }).distinct("_id");
    if (staleOrderIds.length > 0) {
      await mongoose.connection
        .collection("supplierorders")
        .deleteMany({ order: { $in: staleOrderIds } });
      await Order.deleteMany({ _id: { $in: staleOrderIds } });
    }
  }
  await User.deleteMany({ phone: { $in: fixedPhones } });
  await Product.deleteMany({ slug: { $regex: "^(e2e_|e2edemo_)" } });
  await Supplier.deleteMany({ businessName: "E2E Supplier Co" });
  await mongoose.connection.collection("attributes").deleteMany({ slug: { $regex: "^e2e_" } });
  await mongoose.connection.collection("categories").deleteMany({ slug: { $regex: "^e2e_" } });

  // The inline schemas used here do NOT declare the real Product model's
  // sparse unique index on variants.sku, and the dev server's background
  // autoIndex build is async/timing-dependent. Ensure the index exists
  // explicitly (idempotent — mirrors ProductSchema.index({...})) so the
  // E11000 protection test is deterministic. (After the sweep above.)
  await mongoose.connection
    .collection("products")
    .createIndex({ "variants.sku": 1 }, { unique: true, sparse: true });

  // --- Seed users (real passwords, hashed like the app) ---
  const pass = "e2e-test-123";
  const adminUser = await User.create({
    name: "E2E Admin",
    phone: "09121110001",
    passwordHash: await bcrypt.hash(pass, 10),
    role: "admin",
    isActive: true,
  });
  const supplierUser = await User.create({
    name: "E2E Supplier",
    phone: "09121110002",
    passwordHash: await bcrypt.hash(pass, 10),
    role: "supplier",
    isActive: true,
  });
  const customerUser = await User.create({
    name: "E2E Customer",
    phone: "09121110003",
    passwordHash: await bcrypt.hash(pass, 10),
    role: "customer",
    isActive: true,
  });
  const supplierDoc = await Supplier.create({
    user: supplierUser._id,
    businessName: "E2E Supplier Co",
    contactPhone: "09121110002",
    isActive: true,
  });
  await User.findByIdAndUpdate(supplierUser._id, { $set: { supplier: supplierDoc._id } });

  let adminJar = null;
  let supplierJar = null;
  let customerJar = null;

  // =========================================================================
  // LOGIN (real NextAuth flow)
  // =========================================================================
  await testAsync("Real login: admin", async () => {
    adminJar = await login(adminUser.phone, pass);
    assert(adminJar.header().includes("session-token"), "no session cookie");
  });

  await testAsync("Real login: supplier", async () => {
    supplierJar = await login(supplierUser.phone, pass);
    assert(supplierJar.header().includes("session-token"), "no session cookie");
  });

  await testAsync("Real login: customer", async () => {
    customerJar = await login(customerUser.phone, pass);
    assert(customerJar.header().includes("session-token"), "no session cookie");
  });

  // =========================================================================
  // AUTHZ on real routes (401 / 403)
  // =========================================================================
  await testAsync("Unauthenticated /api/admin/products -> 401", async () => {
    const res = await http("GET", "/api/admin/products", null);
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  await testAsync("Customer on /api/admin/products -> 403", async () => {
    const res = await http("GET", "/api/admin/products", customerJar);
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  await testAsync("Supplier on /api/admin/products -> 403", async () => {
    const res = await http("GET", "/api/admin/products", supplierJar);
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  await testAsync("Customer on /api/supplier/products -> 403", async () => {
    const res = await http("GET", "/api/supplier/products", customerJar);
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // =========================================================================
  // ATTRIBUTES via real admin API
  // =========================================================================
  let colorAttrId = null;
  let sizeAttrId = null;

  await testAsync("Create Attribute (رنگ) via /api/admin/attributes", async () => {
    const res = await http("POST", "/api/admin/attributes", adminJar, {
      name: TEST_PREFIX + "رنگ",
      slug: TEST_PREFIX + "color",
      type: "color",
      values: ["قرمز", "آبی"],
      isActive: true,
    });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data));
    colorAttrId = res.data._id;
    assert(colorAttrId, "no attribute _id");
  });

  await testAsync("Create Attribute (سایز) via /api/admin/attributes", async () => {
    const res = await http("POST", "/api/admin/attributes", adminJar, {
      name: TEST_PREFIX + "سایز",
      slug: TEST_PREFIX + "size",
      type: "size",
      values: ["S", "M", "L"],
      isActive: true,
    });
    assert(res.status === 201, "expected 201, got " + res.status);
    sizeAttrId = res.data._id;
  });

  await testAsync("Duplicate attribute slug -> 409", async () => {
    const res = await http("POST", "/api/admin/attributes", adminJar, {
      name: TEST_PREFIX + "رنگ تکراری",
      slug: TEST_PREFIX + "color",
      type: "color",
    });
    assert(res.status === 409, "expected 409, got " + res.status);
  });

  await testAsync("Supplier reads active attributes (200)", async () => {
    const res = await http("GET", "/api/admin/attributes", supplierJar);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(Array.isArray(res.data), "expected array");
  });

  // --- Create a Category via admin API ---
  let categoryId = null;
  await testAsync("Create Category via /api/admin/categories", async () => {
    const res = await http("POST", "/api/admin/categories", adminJar, {
      name: TEST_PREFIX + "Cat",
      slug: TEST_PREFIX + "cat",
      isActive: true,
    });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data));
    categoryId = res.data._id;
  });

  // =========================================================================
  // VARIANT PRODUCT create / edit via real admin API
  // =========================================================================
  let variantProductId = null;
  let redMId = null;

  await testAsync("Create variant product via /api/admin/products", async () => {
    const res = await http("POST", "/api/admin/products", adminJar, {
      name: "E2E Shirt",
      slug: TEST_PREFIX + "shirt",
      description: "variant shirt",
      category: categoryId,
      supplier: String(supplierDoc._id),
      hasVariants: true,
      variants: [
        {
          sku: "E2E-SHIRT-RED-M",
          attributes: [
            { attributeId: colorAttrId, value: "قرمز" },
            { attributeId: sizeAttrId, value: "M" },
          ],
          price: 150000,
          supplierPrice: 110000,
          stock: 1,
          isActive: true,
        },
        {
          sku: "E2E-SHIRT-RED-L",
          attributes: [
            { attributeId: colorAttrId, value: "قرمز" },
            { attributeId: sizeAttrId, value: "L" },
          ],
          price: 160000,
          supplierPrice: 120000,
          stock: 3,
          isActive: true,
        },
        {
          sku: "E2E-SHIRT-BLUE-M",
          attributes: [
            { attributeId: colorAttrId, value: "آبی" },
            { attributeId: sizeAttrId, value: "M" },
          ],
          price: 150000,
          supplierPrice: 110000,
          stock: 2,
          isActive: true,
        },
        {
          sku: "E2E-SHIRT-BLUE-L",
          attributes: [
            { attributeId: colorAttrId, value: "آبی" },
            { attributeId: sizeAttrId, value: "L" },
          ],
          price: 160000,
          supplierPrice: 120000,
          stock: 0,
          isActive: true,
        },
      ],
      isActive: true,
    });
    assert(
      res.status === 201,
      "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 300)
    );
    variantProductId = res.data._id;
    assert(res.data.hasVariants === true, "hasVariants not true");
    assert(res.data.variants.length === 4, "expected 4 variants");
    // Summary: price = min active (150000), stock = sum (6)
    assert(res.data.price === 150000, "summary price should be 150000, got " + res.data.price);
    assert(res.data.stock === 6, "summary stock should be 6, got " + res.data.stock);
    // Each variant has its own _id (variantId)
    redMId = String(res.data.variants[0]._id);
    assert(redMId, "variant _id missing");
    // Denormalized attribute names
    assert(res.data.variants[0].attributes[0].name, "attribute name not denormalized");
  });

  await testAsync("Edit variant product via /api/admin/products (price 150000->170000)", async () => {
    const res = await http("PUT", "/api/admin/products?id=" + variantProductId, adminJar, {
      name: "E2E Shirt",
      slug: TEST_PREFIX + "shirt",
      description: "variant shirt edited",
      category: categoryId,
      supplier: String(supplierDoc._id),
      hasVariants: true,
      variants: [
        {
          sku: "E2E-SHIRT-RED-M",
          attributes: [
            { attributeId: colorAttrId, value: "قرمز" },
            { attributeId: sizeAttrId, value: "M" },
          ],
          price: 170000,
          supplierPrice: 110000,
          stock: 2,
          isActive: true,
        },
        {
          sku: "E2E-SHIRT-RED-L",
          attributes: [
            { attributeId: colorAttrId, value: "قرمز" },
            { attributeId: sizeAttrId, value: "L" },
          ],
          price: 160000,
          supplierPrice: 120000,
          stock: 3,
          isActive: true,
        },
        {
          sku: "E2E-SHIRT-BLUE-M",
          attributes: [
            { attributeId: colorAttrId, value: "آبی" },
            { attributeId: sizeAttrId, value: "M" },
          ],
          price: 150000,
          supplierPrice: 110000,
          stock: 2,
          isActive: true,
        },
        {
          sku: "E2E-SHIRT-BLUE-L",
          attributes: [
            { attributeId: colorAttrId, value: "آبی" },
            { attributeId: sizeAttrId, value: "L" },
          ],
          price: 160000,
          supplierPrice: 120000,
          stock: 0,
          isActive: true,
        },
      ],
      isActive: true,
    });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 200));
    assert(res.data.price === 150000, "summary price should stay min=150000, got " + res.data.price);
    assert(res.data.stock === 7, "summary stock should be 7 (2+3+2+0), got " + res.data.stock);
  });

  await testAsync("GET variant product ?id= returns variants", async () => {
    const res = await http("GET", "/api/admin/products?id=" + variantProductId, adminJar);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.variants.length === 4, "expected 4 variants");
  });

  await testAsync("Public /api/products?slug= returns variant product", async () => {
    const res = await http("GET", "/api/products?slug=" + TEST_PREFIX + "shirt", null);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.hasVariants === true, "hasVariants not true");
    assert(res.data.stock === 7, "summary stock should be 7, got " + res.data.stock);
  });

  // =========================================================================
  // SKU UNIQUENESS — real admin + supplier APIs + DB index
  // =========================================================================
  await testAsync("Duplicate SKU create via admin API -> 409", async () => {
    const res = await http("POST", "/api/admin/products", adminJar, {
      name: "E2E Shirt 2",
      slug: TEST_PREFIX + "shirt2",
      description: "dup sku",
      category: categoryId,
      supplier: String(supplierDoc._id),
      hasVariants: true,
      variants: [
        {
          sku: "E2E-SHIRT-RED-M", // already exists
          attributes: [
            { attributeId: colorAttrId, value: "قرمز" },
            { attributeId: sizeAttrId, value: "M" },
          ],
          price: 100000,
          supplierPrice: 80000,
          stock: 5,
          isActive: true,
        },
      ],
      isActive: true,
    });
    assert(res.status === 409, "expected 409, got " + res.status + " " + JSON.stringify(res.data));
  });

  await testAsync("Duplicate SKU update via admin API -> 409", async () => {
    // Create a product with a unique SKU first
    const created = await http("POST", "/api/admin/products", adminJar, {
      name: "E2E Shirt 3",
      slug: TEST_PREFIX + "shirt3",
      description: "dup sku update",
      category: categoryId,
      supplier: String(supplierDoc._id),
      hasVariants: true,
      variants: [
        {
          sku: "E2E-SHIRT-UNIQUE",
          attributes: [{ attributeId: colorAttrId, value: "قرمز" }],
          price: 100000,
          supplierPrice: 80000,
          stock: 5,
          isActive: true,
        },
      ],
      isActive: true,
    });
    assert(created.status === 201, "setup create failed: " + created.status);
    const prod3Id = created.data._id;

    // Now update it to use the taken SKU -> 409
    const res = await http("PUT", "/api/admin/products?id=" + prod3Id, adminJar, {
      name: "E2E Shirt 3",
      slug: TEST_PREFIX + "shirt3",
      description: "dup sku update",
      category: categoryId,
      supplier: String(supplierDoc._id),
      hasVariants: true,
      variants: [
        {
          sku: "E2E-SHIRT-RED-M", // already taken
          attributes: [{ attributeId: colorAttrId, value: "آبی" }],
          price: 100000,
          supplierPrice: 80000,
          stock: 5,
          isActive: true,
        },
      ],
      isActive: true,
    });
    assert(res.status === 409, "expected 409, got " + res.status + " " + JSON.stringify(res.data));
  });

  await testAsync("Duplicate SKU via supplier API -> 409", async () => {
    const res = await http("POST", "/api/supplier/products", supplierJar, {
      name: "E2E Supplier Shirt",
      slug: TEST_PREFIX + "supp-shirt",
      description: "supplier dup sku",
      category: categoryId,
      hasVariants: true,
      variants: [
        {
          sku: "E2E-SHIRT-RED-M", // already exists (admin product)
          attributes: [
            { attributeId: colorAttrId, value: "آبی" },
            { attributeId: sizeAttrId, value: "L" },
          ],
          price: 100000,
          supplierPrice: 80000,
          stock: 5,
          isActive: true,
        },
      ],
      isActive: true,
    });
    assert(res.status === 409, "expected 409, got " + res.status + " " + JSON.stringify(res.data));
  });

  await testAsync("MongoDB unique index blocks duplicate SKU (E11000)", async () => {
    let errInfo = null;
    try {
      await Product.create({
        name: "E2E Index Test",
        slug: TEST_PREFIX + "index-test",
        category: categoryId,
        supplier: String(supplierDoc._id),
        supplierPrice: 1000,
        price: 1000,
        stock: 1,
        hasVariants: true,
        variants: [
          {
            sku: "E2E-SHIRT-RED-M", // duplicate of the one created via API
            // NOTE: `name` is required by the schema — omitting it fails
            // VALIDATION (a non-E11000 error), which would mask this test.
            attributes: [{ attributeId: colorAttrId, name: "رنگ", value: "قرمز" }],
            price: 1000,
            supplierPrice: 800,
            stock: 1,
            isActive: true,
          },
        ],
        isActive: true,
      });
    } catch (err) {
      errInfo = err;
    }
    // Assert OUTSIDE the try/catch so every failure path — including the
    // critical one where the insert silently SUCCEEDS (index not enforced) —
    // produces a descriptive, diagnosable message.
    assert(
      errInfo && errInfo.code === 11000,
      "expected E11000, got " +
        (errInfo ? "code=" + errInfo.code + ": " + errInfo.message : "no error thrown (index NOT enforced)")
    );
  });

  // =========================================================================
  // CONCURRENT CHECKOUT — real /api/checkout, variant stock = 1
  // =========================================================================
  let concurrencyProductId = null;
  let concurrencyVariantId = null;

  await testAsync("Setup: variant product with stock=1 variant", async () => {
    const res = await http("POST", "/api/admin/products", adminJar, {
      name: "E2E Race Shirt",
      slug: TEST_PREFIX + "race",
      description: "concurrency race",
      category: categoryId,
      supplier: String(supplierDoc._id),
      hasVariants: true,
      variants: [
        {
          sku: "E2E-RACE-ONE",
          attributes: [{ attributeId: colorAttrId, value: "قرمز" }],
          price: 100000,
          supplierPrice: 80000,
          stock: 1, // THE LAST UNIT
          isActive: true,
        },
      ],
      isActive: true,
    });
    assert(res.status === 201, "setup failed: " + res.status + " " + JSON.stringify(res.data).slice(0, 200));
    concurrencyProductId = res.data._id;
    concurrencyVariantId = String(res.data.variants[0]._id);
  });

  // Warm up /api/checkout BEFORE the race so the dev server has compiled the
  // route (the first hit in dev mode triggers compilation and could otherwise
  // 500 one of the two parallel requests). Uses a throwaway simple product.
  await testAsync("Warm-up checkout (dev route compilation)", async () => {
    const warm = await http("POST", "/api/admin/products", adminJar, {
      name: "E2E Warmup",
      slug: TEST_PREFIX + "warmup",
      description: "warmup",
      category: categoryId,
      supplier: String(supplierDoc._id),
      price: 10000,
      supplierPrice: 5000,
      stock: 10,
      isActive: true,
    });
    assert(warm.status === 201, "warmup product create failed: " + warm.status);
    const res = await http("POST", "/api/checkout", customerJar, {
      items: [{ id: warm.data._id, quantity: 1, price: 10000, name: "E2E Warmup" }],
      shippingAddress: { fullName: "E2E C", phone: "09121110003", address: "Test" },
      paymentMethod: "manual",
    });
    assert(res.status === 201, "warmup checkout failed: " + res.status + " " + JSON.stringify(res.data).slice(0, 200));
  });

  await testAsync("Two concurrent checkouts for last variant unit -> exactly 1 succeeds", async () => {
    const body = {
      items: [
        {
          id: concurrencyProductId,
          variantId: concurrencyVariantId,
          quantity: 1,
          price: 100000,
          name: "E2E Race Shirt",
        },
      ],
      shippingAddress: { fullName: "E2E C", phone: "09121110003", address: "Test" },
      paymentMethod: "manual",
    };
    const results = await Promise.all([
      http("POST", "/api/checkout", customerJar, body),
      http("POST", "/api/checkout", customerJar, body),
    ]);
    const ok = results.filter((r) => r.status === 201).length;
    const conflict = results.filter((r) => r.status === 409).length;
    assert(ok === 1, "expected exactly 1 success, got " + ok + " (statuses: " + results.map((r) => r.status).join(",") + ")");
    assert(conflict === 1, "expected exactly 1 conflict, got " + conflict);
  });

  await testAsync("Variant stock = 0 after race (never negative)", async () => {
    const res = await http("GET", "/api/admin/products?id=" + concurrencyProductId, adminJar);
    assert(res.status === 200, "expected 200, got " + res.status);
    const variant = res.data.variants.find((v) => String(v._id) === concurrencyVariantId);
    assert(variant.stock === 0, "variant stock should be 0, got " + variant.stock);
    assert(variant.stock >= 0, "stock must never be negative");
  });

  // =========================================================================
  // SIMPLE PRODUCT regression via real API
  // =========================================================================
  let simpleProductId = null;


  await testAsync("Create simple product (no variants) via admin API", async () => {
    const res = await http("POST", "/api/admin/products", adminJar, {
      name: "E2E Simple",
      slug: TEST_PREFIX + "simple",
      description: "simple product",
      category: categoryId,
      supplier: String(supplierDoc._id),
      price: 50000,
      supplierPrice: 40000,
      stock: 5,
      isActive: true,
    });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 200));
    simpleProductId = res.data._id;
    assert(res.data.hasVariants === false, "hasVariants should be false");
    assert(!res.data.variants || res.data.variants.length === 0, "simple product has no variants");
  });

  await testAsync("Simple product checkout still works (stock 5->4)", async () => {
    const res = await http("POST", "/api/checkout", customerJar, {
      items: [{ id: simpleProductId, quantity: 1, price: 50000, name: "E2E Simple" }],
      shippingAddress: { fullName: "E2E C", phone: "09121110003", address: "Test" },
      paymentMethod: "manual",
    });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 200));
    const prod = await http("GET", "/api/admin/products?id=" + simpleProductId, adminJar);
    assert(prod.data.stock === 4, "simple product stock should be 4, got " + prod.data.stock);
  });

  // =========================================================================
  // PAYMENT CANCEL / FAIL restoration (real verify route)
  // =========================================================================
  async function createOrderForVariant(productId, variantId, price) {
    const res = await http("POST", "/api/checkout", customerJar, {
      items: [
        {
          id: productId,
          variantId,
          quantity: 1,
          price,
          name: "E2E Pay Shirt",
        },
      ],
      shippingAddress: { fullName: "E2E C", phone: "09121110003", address: "Test" },
      paymentMethod: "manual",
    });
    assert(res.status === 201, "checkout failed: " + res.status + " " + JSON.stringify(res.data).slice(0, 200));
    return res.data.orderId;
  }

  await testAsync("Payment cancel (Status=NOK) restores variant stock exactly once", async () => {
    // Fresh variant product with stock=1
    const created = await http("POST", "/api/admin/products", adminJar, {
      name: "E2E Cancel Shirt",
      slug: TEST_PREFIX + "cancel",
      description: "cancel flow",
      category: categoryId,
      supplier: String(supplierDoc._id),
      hasVariants: true,
      variants: [
        {
          sku: "E2E-CANCEL-1",
          attributes: [{ attributeId: colorAttrId, value: "قرمز" }],
          price: 90000,
          supplierPrice: 70000,
          stock: 1,
          isActive: true,
        },
      ],
      isActive: true,
    });
    assert(created.status === 201, "setup failed: " + created.status);
    const pid = created.data._id;
    const vid = String(created.data.variants[0]._id);

    const orderId = await createOrderForVariant(pid, vid, 90000);
    // Stock should now be 0 (reserved)
    let prod = await http("GET", "/api/admin/products?id=" + pid, adminJar);
    let variant = prod.data.variants.find((v) => String(v._id) === vid);
    assert(variant.stock === 0, "stock should be 0 after checkout, got " + variant.stock);

    // Simulate user cancelling at the gateway
    const cancel = await http(
      "GET",
      `/api/payment/verify?Status=NOK&orderId=${orderId}&Authority=bogus-cancel`,
      null
    );
    assert(cancel.status === 307 || cancel.status === 302, "expected redirect on cancel, got " + cancel.status);

    prod = await http("GET", "/api/admin/products?id=" + pid, adminJar);
    variant = prod.data.variants.find((v) => String(v._id) === vid);
    assert(variant.stock === 1, "stock should be restored to 1, got " + variant.stock);

    // Duplicate cancel must NOT double-restore
    await http("GET", `/api/payment/verify?Status=NOK&orderId=${orderId}&Authority=bogus-cancel`, null);
    prod = await http("GET", "/api/admin/products?id=" + pid, adminJar);
    variant = prod.data.variants.find((v) => String(v._id) === vid);
    assert(variant.stock === 1, "second cancel must be a no-op, got " + variant.stock);
  });

  await testAsync("Failed payment restores variant stock exactly once", async () => {
    const created = await http("POST", "/api/admin/products", adminJar, {
      name: "E2E Fail Shirt",
      slug: TEST_PREFIX + "fail",
      description: "fail flow",
      category: categoryId,
      supplier: String(supplierDoc._id),
      hasVariants: true,
      variants: [
        {
          sku: "E2E-FAIL-1",
          attributes: [{ attributeId: colorAttrId, value: "قرمز" }],
          price: 88000,
          supplierPrice: 68000,
          stock: 1,
          isActive: true,
        },
      ],
      isActive: true,
    });
    assert(created.status === 201, "setup failed: " + created.status);
    const pid = created.data._id;
    const vid = String(created.data.variants[0]._id);

    const orderId = await createOrderForVariant(pid, vid, 88000);

    // Bogus authority -> verifyPayment returns null -> order marked failed + restored
    const fail = await http(
      "GET",
      `/api/payment/verify?Authority=bogus-fail-authority&orderId=${orderId}`,
      null
    );
    assert(fail.status === 307 || fail.status === 302, "expected redirect on fail, got " + fail.status);

    const prod = await http("GET", "/api/admin/products?id=" + pid, adminJar);
    const variant = prod.data.variants.find((v) => String(v._id) === vid);
    assert(variant.stock === 1, "stock should be restored to 1 after failed payment, got " + variant.stock);
  });

  await testAsync("Already-paid order -> success redirect, no double restore", async () => {
    const created = await http("POST", "/api/admin/products", adminJar, {
      name: "E2E Paid Shirt",
      slug: TEST_PREFIX + "paid",
      description: "paid guard",
      category: categoryId,
      supplier: String(supplierDoc._id),
      hasVariants: true,
      variants: [
        {
          sku: "E2E-PAID-1",
          attributes: [{ attributeId: colorAttrId, value: "قرمز" }],
          price: 87000,
          supplierPrice: 67000,
          stock: 1,
          isActive: true,
        },
      ],
      isActive: true,
    });
    assert(created.status === 201, "setup failed: " + created.status);
    const pid = created.data._id;
    const vid = String(created.data.variants[0]._id);

    const orderId = await createOrderForVariant(pid, vid, 87000);

    // Manually mark the order paid (simulating a completed Zarinpal tx)
    await Order.updateOne(
      { _id: orderId },
      { $set: { "payment.status": "paid", "payment.refId": "12345", "payment.paidAt": new Date() } }
    );

    const verify = await http(
      "GET",
      `/api/payment/verify?Authority=bogus&orderId=${orderId}`,
      null
    );
    assert(verify.status === 307 || verify.status === 302, "expected redirect, got " + verify.status);
    assert(
      (verify.location || "").includes("status=success"),
      "expected success redirect, got " + verify.location
    );

    // Stock must NOT be restored (paid order keeps stock reserved)
    const prod = await http("GET", "/api/admin/products?id=" + pid, adminJar);
    const variant = prod.data.variants.find((v) => String(v._id) === vid);
    assert(variant.stock === 0, "paid order must NOT restore stock, got " + variant.stock);
  });

  await testAsync("Admin order cancellation restores variant stock", async () => {
    const created = await http("POST", "/api/admin/products", adminJar, {
      name: "E2E AdminCancel Shirt",
      slug: TEST_PREFIX + "admcancel",
      description: "admin cancel",
      category: categoryId,
      supplier: String(supplierDoc._id),
      hasVariants: true,
      variants: [
        {
          sku: "E2E-ADMCANCEL-1",
          attributes: [{ attributeId: colorAttrId, value: "قرمز" }],
          price: 86000,
          supplierPrice: 66000,
          stock: 1,
          isActive: true,
        },
      ],
      isActive: true,
    });
    assert(created.status === 201, "setup failed: " + created.status);
    const pid = created.data._id;
    const vid = String(created.data.variants[0]._id);

    const orderId = await createOrderForVariant(pid, vid, 86000);

    // Admin cancels the order -> stock restored
    const cancelRes = await http("PUT", "/api/admin/orders?id=" + orderId, adminJar, {
      status: "cancelled",
      note: "E2E admin cancel",
    });
    assert(cancelRes.status === 200, "admin cancel failed: " + cancelRes.status + " " + JSON.stringify(cancelRes.data).slice(0, 200));

    const prod = await http("GET", "/api/admin/products?id=" + pid, adminJar);
    const variant = prod.data.variants.find((v) => String(v._id) === vid);
    assert(variant.stock === 1, "stock should be restored to 1 after admin cancel, got " + variant.stock);
  });

  // =========================================================================
  // PAGINATION shape on real /api/products
  // =========================================================================
  await testAsync("Pagination shape on real /api/products", async () => {
    const res = await http("GET", "/api/products?page=1&limit=5", null);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(typeof res.data.total === "number", "total missing");
    assert(typeof res.data.totalPages === "number", "totalPages missing");
    assert(typeof res.data.hasNextPage === "boolean", "hasNextPage missing");
    assert(Array.isArray(res.data.data), "data missing");
    assert(res.data.page === 1, "page should be 1");
    assert(res.data.limit === 5, "limit should be 5");
  });

  // =========================================================================
  // DEMO PRODUCT for storefront browser verification (kept)
  // =========================================================================
  await testAsync("Create demo variant product (kept for browser test)", async () => {
    if (CLEANUP_DEMO) {
      // Skip creation; just clean below
      return;
    }
    const res = await http("POST", "/api/admin/products", adminJar, {
      name: "پیراهن دموی E2E",
      slug: DEMO_SLUG,
      description: "demo variant product for storefront browser verification",
      category: categoryId,
      supplier: String(supplierDoc._id),
      hasVariants: true,
      variants: [
        {
          sku: "E2EDEMO-RED-M",
          attributes: [
            { attributeId: colorAttrId, value: "قرمز" },
            { attributeId: sizeAttrId, value: "M" },
          ],
          price: 150000,
          supplierPrice: 110000,
          stock: 4,
          isActive: true,
        },
        {
          sku: "E2EDEMO-RED-L",
          attributes: [
            { attributeId: colorAttrId, value: "قرمز" },
            { attributeId: sizeAttrId, value: "L" },
          ],
          price: 160000,
          supplierPrice: 120000,
          stock: 2,
          isActive: true,
        },
        {
          sku: "E2EDEMO-BLUE-M",
          attributes: [
            { attributeId: colorAttrId, value: "آبی" },
            { attributeId: sizeAttrId, value: "M" },
          ],
          price: 155000,
          supplierPrice: 115000,
          stock: 0,
          isActive: true,
        },
      ],
      isActive: true,
    });
    assert(res.status === 201, "demo create failed: " + res.status + " " + JSON.stringify(res.data).slice(0, 200));
    console.log("\n  DEMO_URL=" + BASE + "/products/" + DEMO_SLUG);
  });

  // =========================================================================
  // CLEANUP (all test data EXCEPT the demo product unless --cleanup-demo)
  // =========================================================================
  console.log("\nCleaning up test data...");
  const testOrderIds = await Order.find({ customer: customerUser._id }).distinct("_id");
  // Delete supplier orders scoped to THIS test run's orders only
  // (never wipe unrelated supplier orders).
  const SupplierOrder = mongoose.connection.collection("supplierorders");
  const supplierOrderDel = await SupplierOrder.deleteMany({ order: { $in: testOrderIds } });
  await Order.deleteMany({ customer: customerUser._id });
  await Product.deleteMany({ slug: { $regex: "^" + TEST_PREFIX } });
  await User.deleteMany({ _id: { $in: [adminUser._id, supplierUser._id, customerUser._id] } });
  if (CLEANUP_DEMO) {
    // Full cleanup: also remove the demo product + everything it references.
    await Supplier.deleteMany({ _id: supplierDoc._id });
    await Product.deleteMany({ slug: { $regex: "^" + DEMO_PREFIX } });
    await mongoose.connection.collection("attributes").deleteMany({ slug: { $regex: "^" + TEST_PREFIX } });
    await mongoose.connection.collection("categories").deleteMany({ slug: { $regex: "^" + TEST_PREFIX } });
  } else {
    // The demo product is KEPT for storefront browser verification, so keep its
    // dependencies too: the supplier + the test category + the test attributes
    // (its variants reference them by _id). Deleting them would leave the demo
    // with dangling refs (e.g. broken category breadcrumb on the product page).
    console.log("  (demo kept \u2192 supplier, category & attributes kept; run with --cleanup-demo to remove)");
  }
  console.log("  Done (" + supplierOrderDel.deletedCount + " supplier orders removed)");

  // Results
  console.log("\n==================================================================");
  console.log("  RESULTS");
  console.log("==================================================================");
  console.log("  Total:  " + totalTests);
  console.log("  Passed: " + passed);
  console.log("  Failed: " + failed);
  console.log("  Status: " + (failed === 0 ? "ALL PASSED" : failed + " TEST(S) FAILED"));
  console.log("==================================================================");

  await mongoose.disconnect();
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("\nTest suite error:", err);
  process.exit(1);
});
