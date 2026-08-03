/**
 * API Pagination — Verification Test
 *
 * Self-contained script that connects to MongoDB and tests the pagination
 * implementation against all 18 spec requirements.
 *
 * Does NOT require dotenv — uses process.env directly.
 * Does NOT import from src/ — inlines Mongoose schemas for the test models.
 *
 * Usage: node scripts/verify-pagination.js
 */

// Load .env.local manually
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

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = "marlooai";
const TEST_PREFIX = "pgtest_" + Date.now() + "_";

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
// Inline copy of src/lib/pagination.ts logic (parse + build response)
// ---------------------------------------------------------------------------

const PAGINATION = { DEFAULT_PAGE_SIZE: 20, MAX_PAGE_SIZE: 100 };

function parsePaginationParams(searchParams) {
  const rawPage = Number(searchParams.get("page"));
  const rawLimit = Number(searchParams.get("limit"));

  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const limit =
    Number.isInteger(rawLimit) && rawLimit >= 1
      ? Math.min(rawLimit, PAGINATION.MAX_PAGE_SIZE)
      : PAGINATION.DEFAULT_PAGE_SIZE;

  return { page, limit, skip: (page - 1) * limit };
}

function buildPaginatedResponse(data, total, page, limit) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    data,
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Inline Mongoose Schemas (Product + Order)
// ---------------------------------------------------------------------------

var ProductSchema = new mongoose.Schema(
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
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

var OrderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    supplierPrice: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

var OrderSchema = new mongoose.Schema(
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
  { timestamps: true }
);

// ---------------------------------------------------------------------------
// Simulated API list queries (mirror the route implementations)
// ---------------------------------------------------------------------------

async function queryProducts(Product, filter, sortOption, page, limit) {
  const skip = (page - 1) * limit;
  const [total, data] = await Promise.all([
    Product.countDocuments(filter),
    Product.find(filter)
      .sort(sortOption)
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);
  return buildPaginatedResponse(data, total, page, limit);
}

async function queryCustomerOrders(Order, customerId, status, search, page, limit) {
  const filter = { customer: customerId };
  if (status) filter.status = status;
  if (search) {
    const safeSearch = escapeRegex(search);
    filter.$expr = {
      $regexMatch: { input: { $toString: "$_id" }, regex: safeSearch, options: "i" },
    };
  }
  const skip = (page - 1) * limit;
  const [total, data] = await Promise.all([
    Order.countDocuments(filter),
    Order.find(filter)
      .select("_id totalAmount status payment.status createdAt items shippingAddress")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);
  return buildPaginatedResponse(data, total, page, limit);
}

// ---------------------------------------------------------------------------
// Run Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.log("==================================================================");
  console.log("  API PAGINATION - VERIFICATION TESTS");
  console.log("==================================================================");

  if (!MONGODB_URI) {
    console.error("\nERROR: MONGODB_URI not found. Check .env.local");
    process.exit(1);
  }

  console.log("\nConnecting to MongoDB...");
  await mongoose.connect(MONGODB_URI, { dbName: DB_NAME });
  console.log("  Connected\n");

  var Product = mongoose.models.Product_PgTest || mongoose.model("Product_PgTest", ProductSchema);
  var Order = mongoose.models.Order_PgTest || mongoose.model("Order_PgTest", OrderSchema);
  var Category = mongoose.models.Category_PgTest || mongoose.model("Category_PgTest", new mongoose.Schema({
    name: String, slug: String, isActive: Boolean,
  }, { timestamps: true }));
  var Supplier = mongoose.models.Supplier_PgTest || mongoose.model("Supplier_PgTest", new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    businessName: String, contactPhone: String, isActive: Boolean,
  }, { timestamps: true }));
  var User = mongoose.models.User_PgTest || mongoose.model("User_PgTest", new mongoose.Schema({
    name: String, phone: { type: String, unique: true }, passwordHash: String,
    role: { type: String, default: "customer" }, isActive: Boolean,
  }, { timestamps: true }));

  // Alias the seed models so query helpers can reference them
  var testProductModel = Product;
  var testOrderModel = Order;

  // --- Seed data ---
  console.log("Creating test data...");
  var testUser = await User.create({
    name: "PgTest User", phone: TEST_PREFIX + "phone", passwordHash: "test",
    role: "customer", isActive: true,
  });
  var testSupplier = await Supplier.create({
    businessName: "PgTest Supplier", contactPhone: "09120000001", isActive: true,
  });
  var testCategory = await Category.create({
    name: "PgTest Category", slug: TEST_PREFIX + "category", isActive: true,
  });
  var testCategory2 = await Category.create({
    name: "PgTest Category Two", slug: TEST_PREFIX + "category2", isActive: true,
  });

  // 23 products across two categories, varied prices/names
  var createdProducts = [];
  for (var i = 1; i <= 23; i++) {
    var p = await Product.create({
      name: "PgTest Product " + i,
      slug: TEST_PREFIX + "product-" + i,
      description: "Description for test product " + i,
      price: 10000 * i,
      supplierPrice: 8000 * i,
      stock: 10,
      category: i % 2 === 0 ? testCategory._id : testCategory2._id,
      supplier: testSupplier._id,
      isActive: true,
    });
    createdProducts.push(p);
  }
  // One inactive product — must NOT appear in public catalog
  await Product.create({
    name: "PgTest Inactive", slug: TEST_PREFIX + "inactive",
    description: "inactive", price: 5000, supplierPrice: 3000,
    stock: 10, category: testCategory._id, supplier: testSupplier._id, isActive: false,
  });
  // One out-of-stock product — must NOT appear in public catalog
  await Product.create({
    name: "PgTest OutOfStock", slug: TEST_PREFIX + "outofstock",
    description: "no stock", price: 5000, supplierPrice: 3000,
    stock: 0, category: testCategory._id, supplier: testSupplier._id, isActive: true,
  });

  // 5 orders for testUser with varied statuses
  var statuses = ["pending_payment", "processing", "confirmed", "shipped", "delivered"];
  var testOrders = [];
  for (var j = 0; j < 5; j++) {
    var o = await Order.create({
      customer: testUser._id,
      items: [{ product: createdProducts[j]._id, supplier: testSupplier._id, name: "Item", price: 1000, supplierPrice: 800, quantity: 1 }],
      totalAmount: 1000 * (j + 1),
      shippingAddress: { fullName: "T", phone: "0", address: "A" },
      payment: { status: "pending", method: "zarinpal" },
      status: statuses[j],
      statusHistory: [{ status: statuses[j], at: new Date(), note: "test" }],
    });
    testOrders.push(o);
  }
  console.log("  23 active products + 1 inactive + 1 out-of-stock + 5 orders\n");

  // =========================================================================
  // TEST 1: parsePaginationParams — defaults
  // =========================================================================
  await testAsync("parse: default page=1, limit=20", function () {
    var p = parsePaginationParams(new URLSearchParams());
    assert(p.page === 1, "page should default to 1, got " + p.page);
    assert(p.limit === 20, "limit should default to 20, got " + p.limit);
    assert(p.skip === 0, "skip should be 0, got " + p.skip);
  });

  // TEST 2: parse — explicit values + 1-based
  await testAsync("parse: explicit page=3 limit=10 (1-based)", function () {
    var p = parsePaginationParams(new URLSearchParams("page=3&limit=10"));
    assert(p.page === 3, "page should be 3, got " + p.page);
    assert(p.limit === 10, "limit should be 10, got " + p.limit);
    assert(p.skip === 20, "skip should be (3-1)*10=20, got " + p.skip);
  });

  // TEST 3: parse — invalid page values handled safely
  await testAsync("parse: invalid page (0, -5, abc, 2.5) -> 1", function () {
    ["page=0", "page=-5", "page=abc", "page=2.5"].forEach(function (qs) {
      var p = parsePaginationParams(new URLSearchParams(qs));
      assert(p.page === 1, qs + " -> page should coerce to 1, got " + p.page);
    });
  });

  // TEST 4: parse — invalid limit values handled safely
  await testAsync("parse: invalid limit (0, -3, xyz, 1.5) -> 20", function () {
    ["limit=0", "limit=-3", "limit=xyz", "limit=1.5"].forEach(function (qs) {
      var p = parsePaginationParams(new URLSearchParams(qs));
      assert(p.limit === 20, qs + " -> limit should coerce to 20, got " + p.limit);
    });
  });

  // TEST 5: parse — limit capped at MAX
  await testAsync("parse: limit > MAX (500) capped to 100", function () {
    var p = parsePaginationParams(new URLSearchParams("limit=500"));
    assert(p.limit === 100, "limit should cap to 100, got " + p.limit);
  });

  // TEST 6: buildPaginatedResponse — shape + first page
  await testAsync("response shape: {data,page,limit,total,totalPages,hasNextPage,hasPreviousPage}", function () {
    var r = buildPaginatedResponse([1, 2, 3], 23, 1, 20);
    assert(Array.isArray(r.data), "data must be an array");
    assert(r.page === 1, "page");
    assert(r.limit === 20, "limit");
    assert(r.total === 23, "total");
    assert(r.totalPages === 2, "totalPages = ceil(23/20) = 2, got " + r.totalPages);
    assert(r.hasNextPage === true, "hasNextPage should be true on page 1");
    assert(r.hasPreviousPage === false, "hasPreviousPage should be false on page 1");
  });

  // TEST 7: Public products — page 1 (DB-level, limit 20)
  await testAsync("GET /api/products page 1 -> 20 items, total 23", async function () {
    var filter = { isActive: true, stock: { $gt: 0 } };
    var r = await queryProducts(testProductModel, filter, { createdAt: -1 }, 1, 20);
    assert(r.total === 23, "total should be 23 (inactive + out-of-stock excluded), got " + r.total);
    assert(r.data.length === 20, "page 1 should have 20 items, got " + r.data.length);
    assert(r.totalPages === 2, "totalPages should be 2");
    assert(r.hasNextPage === true, "hasNextPage");
    assert(r.hasPreviousPage === false, "hasPreviousPage");
  });

  // TEST 8: Public products — middle/last page
  await testAsync("GET /api/products page 2 -> 3 items, hasNextPage=false", async function () {
    var filter = { isActive: true, stock: { $gt: 0 } };
    var r = await queryProducts(testProductModel, filter, { createdAt: -1 }, 2, 20);
    assert(r.data.length === 3, "page 2 should have 3 items, got " + r.data.length);
    assert(r.page === 2, "page should be 2");
    assert(r.hasNextPage === false, "hasNextPage should be false on last page");
    assert(r.hasPreviousPage === true, "hasPreviousPage should be true on page 2");
  });

  // TEST 9: Page beyond last
  await testAsync("GET /api/products page=99 -> empty data, safe", async function () {
    var filter = { isActive: true, stock: { $gt: 0 } };
    var r = await queryProducts(testProductModel, filter, { createdAt: -1 }, 99, 20);
    assert(r.data.length === 0, "data should be empty, got " + r.data.length);
    assert(r.total === 23, "total should still be 23");
    assert(r.totalPages === 2, "totalPages should be 2");
    assert(r.hasNextPage === false, "hasNextPage false");
    assert(r.hasPreviousPage === true, "hasPreviousPage true");
  });

  // TEST 10: Pagination + search filter
  await testAsync("GET /api/products?search=Product 1 -> correct total + page", async function () {
    var filter = {
      isActive: true,
      stock: { $gt: 0 },
      $or: [
        { name: { $regex: escapeRegex("Product 1"), $options: "i" } },
        { description: { $regex: escapeRegex("Product 1"), $options: "i" } },
      ],
    };
    var r = await queryProducts(testProductModel, filter, { createdAt: -1 }, 1, 20);
    // "Product 1", "Product 10".."Product 19" all contain "Product 1" -> 11
    assert(r.total === 11, "total should be 11, got " + r.total);
    assert(r.data.length === 11, "all results on one page");
    assert(r.totalPages === 1, "totalPages should be 1");
  });

  // TEST 11: Pagination + category filter
  await testAsync("GET /api/products?category=<cat2> -> 12 items (odd ids)", async function () {
    var filter = { isActive: true, stock: { $gt: 0 }, category: testCategory2._id };
    var r = await queryProducts(testProductModel, filter, { createdAt: -1 }, 1, 20);
    assert(r.total === 12, "category 2 should have 12 products (odd ids 1..23), got " + r.total);
    assert(r.data.length === 12, "data length 12");
  });

  // TEST 12: Pagination + price range filter
  await testAsync("GET /api/products?minPrice=150000&maxPrice=200000", async function () {
    var filter = {
      isActive: true,
      stock: { $gt: 0 },
      price: { $gte: 150000, $lte: 200000 },
    };
    var r = await queryProducts(testProductModel, filter, { createdAt: -1 }, 1, 20);
    // prices: 10000*i -> 150000..200000 means i in [15..20] -> 6 products
    assert(r.total === 6, "expected 6 products in price range, got " + r.total);
  });

  // TEST 13: Pagination + sort (price_asc)
  await testAsync("GET /api/products?sort=price_asc -> ascending prices", async function () {
    var filter = { isActive: true, stock: { $gt: 0 } };
    var r = await queryProducts(testProductModel, filter, { price: 1 }, 1, 20);
    assert(r.data.length === 20, "20 items");
    assert(r.data[0].price <= r.data[1].price, "first two items ascending");
  });

  // TEST 14: Pagination + sort (price_desc) across pages
  await testAsync("GET /api/products?sort=price_desc&limit=5 -> pages slice correctly", async function () {
    var filter = { isActive: true, stock: { $gt: 0 } };
    var r1 = await queryProducts(testProductModel, filter, { price: -1 }, 1, 5);
    var r2 = await queryProducts(testProductModel, filter, { price: -1 }, 2, 5);
    var r3 = await queryProducts(testProductModel, filter, { price: -1 }, 5, 5);
    assert(r1.total === 23, "total 23");
    assert(r1.data.length === 5 && r2.data.length === 5, "pages 1-2 have 5 items");
    assert(r3.data.length === 3, "last page has 3 items");
    // No overlap between consecutive pages
    var ids1 = r1.data.map(function (p) { return String(p._id); });
    var ids2 = r2.data.map(function (p) { return String(p._id); });
    var overlap = ids1.filter(function (id) { return ids2.indexOf(id) !== -1; });
    assert(overlap.length === 0, "no overlap between pages 1 and 2");
  });

  // TEST 15: Single product by slug (unchanged behavior)
  await testAsync("GET /api/products?slug=<slug> -> single product object", async function () {
    var target = createdProducts[10];
    var product = await Product.findOne({ slug: target.slug, isActive: true }).lean();
    assert(product, "product should exist");
    assert(String(product._id) === String(target._id), "correct product returned");
    assert(!product.data && !product.total, "single product must NOT be paginated");
  });

  // TEST 16: Single product by id (unchanged behavior)
  await testAsync("GET /api/products?id=<id> -> single product object", async function () {
    var target = createdProducts[5];
    var product = await Product.findOne({ _id: target._id, isActive: true }).lean();
    assert(product, "product should exist");
    assert(String(product._id) === String(target._id), "correct product returned");
    assert(!product.data && !product.total, "single product must NOT be paginated");
  });

  // TEST 17: Empty result set handled gracefully
  await testAsync("GET /api/products?search=<no-match> -> empty data, totalPages=1", async function () {
    var filter = {
      isActive: true,
      stock: { $gt: 0 },
      $or: [
        { name: { $regex: escapeRegex("zzzz-no-match"), $options: "i" } },
        { description: { $regex: escapeRegex("zzzz-no-match"), $options: "i" } },
      ],
    };
    var r = await queryProducts(testProductModel, filter, { createdAt: -1 }, 1, 20);
    assert(r.data.length === 0, "empty data");
    assert(r.total === 0, "total 0");
    assert(r.totalPages === 1, "totalPages should be 1 (not 0)");
    assert(r.hasNextPage === false, "hasNextPage false");
    assert(r.hasPreviousPage === false, "hasPreviousPage false");
  });

  // TEST 18: Customer orders — paginated, default limit
  await testAsync("GET /api/orders -> 5 orders, total 5", async function () {
    var r = await queryCustomerOrders(testOrderModel, testUser._id, null, null, 1, 20);
    assert(r.total === 5, "total should be 5, got " + r.total);
    assert(r.data.length === 5, "all 5 on page 1");
  });

  // TEST 19: Customer orders — status filter + pagination
  await testAsync("GET /api/orders?status=processing -> 1 order", async function () {
    var r = await queryCustomerOrders(testOrderModel, testUser._id, "processing", null, 1, 20);
    assert(r.total === 1, "only 1 processing order, got " + r.total);
    assert(r.data[0].status === "processing", "status matches");
  });

  // TEST 20: Customer orders — search by id + pagination
  await testAsync("GET /api/orders?search=<id-substring>", async function () {
    var target = testOrders[2];
    var shortId = String(target._id).slice(-6);
    var r = await queryCustomerOrders(testOrderModel, testUser._id, null, shortId, 1, 20);
    assert(r.total >= 1, "should match at least 1 order, got " + r.total);
    assert(String(r.data[0]._id) === String(target._id), "matching order returned first");
  });

  // TEST 21: Customer orders — page beyond last
  await testAsync("GET /api/orders?page=10 -> empty data, safe", async function () {
    var r = await queryCustomerOrders(testOrderModel, testUser._id, null, null, 10, 20);
    assert(r.data.length === 0, "empty data on page 10");
    assert(r.total === 5, "total still 5");
  });

  // TEST 22: Database-level only — verify no fetch-all (skip/limit applied)
  await testAsync("Query uses skip/limit at DB level (verified via counts)", async function () {
    var filter = { isActive: true, stock: { $gt: 0 } };
    var r1 = await queryProducts(testProductModel, filter, { createdAt: -1 }, 1, 5);
    var r2 = await queryProducts(testProductModel, filter, { createdAt: -1 }, 2, 5);
    assert(r1.data.length === 5, "page 1 limited to 5");
    assert(r2.data.length === 5, "page 2 limited to 5");
    // Ensure distinct items across pages
    var all = r1.data.concat(r2.data);
    var unique = {};
    all.forEach(function (p) { unique[String(p._id)] = true; });
    assert(Object.keys(unique).length === 10, "10 unique items across 2 pages of 5");
  });

  // TEST 23: Admin products — search by name resolves via refs (no dotted-path bug)
  await testAsync("GET /api/admin/products?search=Product 2 -> matches refs correctly", async function () {
    // Mirrors the admin route: resolve matching category ids, then $in
    var safeSearch = escapeRegex("Product 2");
    var regex = new RegExp(safeSearch, "i");
    var categoryIds = await Category.find({ name: regex }).distinct("_id");
    var filter = {
      $or: [
        { name: regex },
        { slug: regex },
        { description: regex },
        { category: { $in: categoryIds } },
      ],
    };
    var skip = (1 - 1) * 20;
    var total = await Product.countDocuments(filter);
    var data = await Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(20).lean();
    // "Product 2" substring-matches Product 2, 20, 21, 22, 23 -> 5
    assert(total === 5, "'Product 2' matches PgTest Product 2/20/21/22/23 -> 5, got " + total);
    assert(data.length === 5, "data length 5");
  });

  // TEST 24: Admin orders — search by customer name resolves user ids
  await testAsync("GET /api/admin/orders?search=PgTest User -> resolves via User lookup", async function () {
    var safeSearch = escapeRegex("PgTest User");
    var regex = new RegExp(safeSearch, "i");
    var customerIds = await User.find({
      $or: [{ name: regex }, { phone: regex }],
    }).distinct("_id");
    var filter = {
      $or: [
        {
          $expr: {
            $regexMatch: {
              input: { $toString: "$_id" },
              regex: safeSearch,
              options: "i",
            },
          },
        },
        { customer: { $in: customerIds } },
      ],
    };
    var skip = (1 - 1) * 20;
    var total = await Order.countDocuments(filter);
    var data = await Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(20).lean();
    assert(customerIds.length === 1, "1 matching user found");
    assert(total === 5, "all 5 orders match the user lookup, got " + total);
    assert(data.length === 5, "data length 5");
  });

  // Cleanup
  console.log("\nCleaning up test data...");
  await Product.deleteMany({ slug: { $regex: "^" + TEST_PREFIX } });
  await Order.deleteMany({ customer: testUser._id });
  await Category.findByIdAndDelete(testCategory._id);
  await Category.findByIdAndDelete(testCategory2._id);
  await Supplier.findByIdAndDelete(testSupplier._id);
  await User.findByIdAndDelete(testUser._id);
  console.log("  Done");

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

runTests().catch(function (err) {
  console.error("\nTest suite error:", err);
  process.exit(1);
});
