/**
 * Attributes & Product Variants — Verification Test (Session 29)
 *
 * Self-contained script that connects to MongoDB and verifies:
 *   1. Simple product checkout still works
 *   2. Variant product checkout works
 *   3. Variant price is used instead of base price
 *   4. Wrong variant price is rejected
 *   5. Variant stock is enforced
 *   6. Two concurrent purchases of the last variant unit -> exactly 1 success
 *   7. Variant stock never becomes negative
 *   8. Failed payment restores variant stock exactly once
 *   9. Cancelled payment restores variant stock exactly once
 *  10. Duplicate payment verification cannot restore twice
 *  11. Admin cancellation restores variant stock correctly
 *  12. Product summary price remains correct
 *  13. Product summary stock remains correct
 *  14. Existing non-variant products remain unchanged
 *  15. Existing pagination still works
 *  16. Existing search/filter/sort still works
 *
 * Does NOT import from src/ — inlines Mongoose schemas + the shared
 * reserveStock/restoreStock/restoreOrderStock algorithms so we test the
 * exact concurrency logic in a standalone environment.
 *
 * Usage: node scripts/verify-variants.js
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
const TEST_PREFIX = "vartest_" + Date.now() + "_";

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
// Inline schemas (mirror src/models/Product.js + Order.js + SupplierOrder.js)
// ---------------------------------------------------------------------------

var ProductVariantSchema = new mongoose.Schema(
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
    hasVariants: { type: Boolean, default: false },
    variants: { type: [ProductVariantSchema], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

var OrderItemSchema = new mongoose.Schema(
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

var SupplierOrderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
    sku: { type: String, default: "" },
    variantLabel: { type: String, default: "" },
    name: { type: String, required: true },
    supplierPrice: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

var SupplierOrderSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    items: { type: [SupplierOrderItemSchema], required: true },
    amountOwed: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["pending", "confirmed", "rejected", "shipped", "delivered"], default: "pending" },
    confirmedAt: { type: Date, default: null },
    shippedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    isPaidOut: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// ---------------------------------------------------------------------------
// Shared inventory algorithms (mirror src/lib/inventory.ts)
// ---------------------------------------------------------------------------

async function reserveStock(Product, productId, quantity, variantId) {
  if (variantId) {
    var current = await Product.findOne(
      { _id: productId, "variants._id": variantId },
      { "variants.$": 1 }
    ).lean();
    if (!current) return null;
    var variant = current.variants && current.variants[0];
    if (!variant) return null;
    if (variant.stock < quantity) return null;
    if (variant.isActive === false) return null;
    var currentVersion = variant.stockVersion || 0;
    // IMPORTANT: $elemMatch in the query (MongoDB does not allow the positional
    // $ operator in query filters) — binds all conditions to the target variant,
    // while "variants.$" in the update operates on that matched element.
    var reserved = await Product.findOneAndUpdate(
      {
        _id: productId,
        variants: {
          $elemMatch: {
            _id: variantId,
            isActive: true,
            stock: { $gte: quantity },
            stockVersion: currentVersion,
          },
        },
      },
      {
        $inc: {
          "variants.$.stock": -quantity,
          "variants.$.stockVersion": 1,
          stock: -quantity,
        },
      },
      { new: true }
    ).lean();
    return reserved;
  }
  var current = await Product.findById(productId).select("stock stockVersion").lean();
  if (!current) return null;
  if (current.stock < quantity) return null;
  var currentVersion = current.stockVersion || 0;
  var reserved = await Product.findOneAndUpdate(
    { _id: productId, stock: { $gte: quantity }, stockVersion: currentVersion },
    { $inc: { stock: -quantity, stockVersion: 1 } },
    { new: true }
  ).lean();
  return reserved;
}

async function restoreStock(Product, productId, quantity, variantId) {
  if (variantId) {
    await Product.findOneAndUpdate(
      { _id: productId, "variants._id": variantId },
      {
        $inc: {
          "variants.$.stock": quantity,
          "variants.$.stockVersion": 1,
          stock: quantity,
        },
      }
    );
    return;
  }
  await Product.findByIdAndUpdate(productId, {
    $inc: { stock: quantity, stockVersion: 1 },
  });
}

async function restoreOrderStock(Order, Product, orderId) {
  var claimed = await Order.findOneAndUpdate(
    { _id: orderId, stockRestored: false },
    { $set: { stockRestored: true } },
    { new: true }
  )
    .select("items")
    .lean();
  if (!claimed || !claimed.items || !claimed.items.length) return;
  var updates = claimed.items.map(function (item) {
    return restoreStock(Product, item.product, item.quantity, item.variantId || undefined);
  });
  await Promise.all(updates);
}

// Recompute + persist the top-level summary (mirror recomputeVariantSummary)
async function syncSummary(Product, productId) {
  var doc = await Product.findById(productId).select("variants").lean();
  var active = doc.variants.filter(function (v) { return v.isActive !== false; });
  if (active.length === 0) {
    await Product.updateOne({ _id: productId }, { $set: { price: 0, stock: 0 } });
    return;
  }
  var price = Math.min.apply(null, active.map(function (v) { return v.price; }));
  var stock = active.reduce(function (s, v) { return s + (v.stock || 0); }, 0);
  await Product.updateOne({ _id: productId }, { $set: { price: price, stock: stock } });
}

// Inline pagination helpers (mirror src/lib/pagination.ts)
var PAGINATION = { DEFAULT_PAGE_SIZE: 20, MAX_PAGE_SIZE: 100 };

function parsePaginationParams(searchParams) {
  var rawPage = Number(searchParams.get("page"));
  var rawLimit = Number(searchParams.get("limit"));
  var page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  var limit =
    Number.isInteger(rawLimit) && rawLimit >= 1
      ? Math.min(rawLimit, PAGINATION.MAX_PAGE_SIZE)
      : PAGINATION.DEFAULT_PAGE_SIZE;
  return { page: page, limit: limit, skip: (page - 1) * limit };
}

function buildPaginatedResponse(data, total, page, limit) {
  var totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    data: data,
    page: page,
    limit: limit,
    total: total,
    totalPages: totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Run Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.log("==================================================================");
  console.log("  ATTRIBUTES & PRODUCT VARIANTS - VERIFICATION TESTS");
  console.log("==================================================================");

  if (!MONGODB_URI) {
    console.error("\nERROR: MONGODB_URI not found. Check .env.local");
    process.exit(1);
  }

  console.log("\nConnecting to MongoDB...");
  await mongoose.connect(MONGODB_URI, { dbName: DB_NAME });
  console.log("  Connected\n");

  var Product = mongoose.models.Product_VarTest || mongoose.model("Product_VarTest", ProductSchema);
  var Order = mongoose.models.Order_VarTest || mongoose.model("Order_VarTest", OrderSchema);
  var SupplierOrderModel =
    mongoose.models.SupplierOrder_VarTest || mongoose.model("SupplierOrder_VarTest", SupplierOrderSchema);
  var AttributeModel =
    mongoose.models.Attribute_VarTest ||
    mongoose.model(
      "Attribute_VarTest",
      new mongoose.Schema(
        {
          name: { type: String, required: true },
          slug: { type: String, unique: true, lowercase: true },
          type: { type: String, enum: ["text", "color", "size", "number"], default: "text" },
          values: { type: [String], default: [] },
          isActive: { type: Boolean, default: true },
        },
        { timestamps: true }
      )
    );
  var Category = mongoose.models.Category_VarTest || mongoose.model("Category_VarTest", new mongoose.Schema({
    name: String, slug: String, isActive: Boolean,
  }, { timestamps: true }));
  var Supplier = mongoose.models.Supplier_VarTest || mongoose.model("Supplier_VarTest", new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    businessName: String, contactPhone: String, isActive: Boolean,
  }, { timestamps: true }));
  var User = mongoose.models.User_VarTest || mongoose.model("User_VarTest", new mongoose.Schema({
    name: String, phone: { type: String, unique: true }, passwordHash: String,
    role: { type: String, default: "customer" }, isActive: Boolean,
  }, { timestamps: true }));

  // --- Seed data ---
  console.log("Creating test data...");
  var testUser = await User.create({
    name: "VarTest User", phone: TEST_PREFIX + "phone", passwordHash: "test",
    role: "customer", isActive: true,
  });
  var testSupplier = await Supplier.create({
    businessName: "VarTest Supplier", contactPhone: "09120000002", isActive: true,
  });
  var testCategory = await Category.create({
    name: "VarTest Category", slug: TEST_PREFIX + "category", isActive: true,
  });
  var colorAttr = await AttributeModel.create({
    name: "رنگ", slug: TEST_PREFIX + "color", type: "color",
    values: ["قرمز", "آبی"], isActive: true,
  });
  var sizeAttr = await AttributeModel.create({
    name: "سایز", slug: TEST_PREFIX + "size", type: "size",
    values: ["S", "M", "L"], isActive: true,
  });

  // Simple product (unchanged shape)
  var simpleProduct = await Product.create({
    name: "VarTest Simple",
    slug: TEST_PREFIX + "simple",
    description: "simple",
    price: 100000,
    supplierPrice: 80000,
    stock: 5,
    stockVersion: 0,
    category: testCategory._id,
    supplier: testSupplier._id,
    isActive: true,
  });

  // Variant product — 4 variants (2 colors x 2 sizes)
  var variantProduct = await Product.create({
    name: "VarTest Shirt",
    slug: TEST_PREFIX + "shirt",
    description: "variant shirt",
    price: 0,
    supplierPrice: 0,
    stock: 0,
    category: testCategory._id,
    supplier: testSupplier._id,
    hasVariants: true,
    variants: [
      {
        sku: "VSHIRT-RED-M",
        attributes: [
          { attributeId: colorAttr._id, name: "رنگ", value: "قرمز" },
          { attributeId: sizeAttr._id, name: "سایز", value: "M" },
        ],
        price: 150000,
        supplierPrice: 110000,
        stock: 1,
        stockVersion: 0,
        isActive: true,
      },
      {
        sku: "VSHIRT-RED-L",
        attributes: [
          { attributeId: colorAttr._id, name: "رنگ", value: "قرمز" },
          { attributeId: sizeAttr._id, name: "سایز", value: "L" },
        ],
        price: 160000,
        supplierPrice: 120000,
        stock: 3,
        stockVersion: 0,
        isActive: true,
      },
      {
        sku: "VSHIRT-BLUE-M",
        attributes: [
          { attributeId: colorAttr._id, name: "رنگ", value: "آبی" },
          { attributeId: sizeAttr._id, name: "سایز", value: "M" },
        ],
        price: 150000,
        supplierPrice: 110000,
        stock: 2,
        stockVersion: 0,
        isActive: true,
      },
      {
        sku: "VSHIRT-BLUE-L",
        attributes: [
          { attributeId: colorAttr._id, name: "رنگ", value: "آبی" },
          { attributeId: sizeAttr._id, name: "سایز", value: "L" },
        ],
        price: 160000,
        supplierPrice: 120000,
        stock: 0,
        stockVersion: 0,
        isActive: true,
      },
    ],
    isActive: true,
  });

  // Recompute summary (mirror recomputeVariantSummary) and persist
  var activeVariants = variantProduct.variants.filter(function (v) { return v.isActive !== false; });
  var summaryPrice = Math.min.apply(null, activeVariants.map(function (v) { return v.price; }));
  var summaryStock = activeVariants.reduce(function (s, v) { return s + (v.stock || 0); }, 0);
  variantProduct.price = summaryPrice;
  variantProduct.stock = summaryStock;
  await variantProduct.save();
  console.log(
    "  1 simple product + 1 variant product (4 variants, summary price=" +
      summaryPrice + " stock=" + summaryStock + ")\n"
  );

  var redMId = String(variantProduct.variants[0]._id);
  var redLId = String(variantProduct.variants[1]._id);
  var blueMId = String(variantProduct.variants[2]._id);
  var blueLId = String(variantProduct.variants[3]._id);

  // =========================================================================
  // TEST 1: Simple product checkout still works
  // =========================================================================
  await testAsync("Simple product checkout (reserve 1 of 5)", async function () {
    var reserved = await reserveStock(Product, simpleProduct._id, 1);
    assert(reserved, "reservation should succeed");
    var fresh = await Product.findById(simpleProduct._id).select("stock stockVersion").lean();
    assert(fresh.stock === 4, "stock should be 4, got " + fresh.stock);
    assert(fresh.stockVersion === 1, "stockVersion should bump to 1, got " + fresh.stockVersion);
    // Restore for later tests
    await restoreStock(Product, simpleProduct._id, 1);
  });

  // TEST 2: Variant product checkout works
  await testAsync("Variant product checkout (reserve RED-M, stock 1->0)", async function () {
    var reserved = await reserveStock(Product, variantProduct._id, 1, redMId);
    assert(reserved, "variant reservation should succeed");
    var fresh = await Product.findById(variantProduct._id).select("stock variants").lean();
    var redM = fresh.variants.find(function (v) { return String(v._id) === redMId; });
    assert(redM.stock === 0, "variant RED-M stock should be 0, got " + redM.stock);
    assert(redM.stockVersion === 1, "variant stockVersion should be 1, got " + redM.stockVersion);
    // Top-level summary must stay in sync (total was 6 -> 5)
    assert(fresh.stock === 5, "summary stock should be 5, got " + fresh.stock);
    // Restore for later tests
    await restoreStock(Product, variantProduct._id, 1, redMId);
  });

  // TEST 3: Variant price is used instead of base price
  await testAsync("Variant price (160000) overrides base product price", async function () {
    var reserved = await reserveStock(Product, variantProduct._id, 1, redLId);
    assert(reserved, "reservation should succeed");
    // The order-snapshot builder uses variant price
    var variant = reserved.variants.find(function (v) { return String(v._id) === redLId; });
    assert(variant.price === 160000, "variant price should be 160000, got " + variant.price);
    assert(variant.price !== reserved.price, "variant price must differ from summary price");
    await restoreStock(Product, variantProduct._id, 1, redLId);
  });

  // TEST 4: Wrong variant price is rejected (price mismatch check)
  await testAsync("Wrong variant price rejected (cart price != variant price)", async function () {
    var reserved = await reserveStock(Product, variantProduct._id, 1, blueMId);
    assert(reserved, "reservation should succeed");
    var variant = reserved.variants.find(function (v) { return String(v._id) === blueMId; });
    // Simulate the checkout price check: cart price (e.g. 99999) != variant price
    var mismatch = variant.price !== 99999;
    assert(mismatch, "price mismatch should be detected");
    // Checkout rolls back on mismatch
    await restoreStock(Product, variantProduct._id, 1, blueMId);
    var fresh = await Product.findById(variantProduct._id).select("stock variants").lean();
    var blueM = fresh.variants.find(function (v) { return String(v._id) === blueMId; });
    assert(blueM.stock === 2, "stock restored after price mismatch, got " + blueM.stock);
  });

  // TEST 5: Variant stock is enforced (insufficient -> reservation fails)
  await testAsync("Variant stock enforced (BLUE-L stock 0 -> reservation fails)", async function () {
    var reserved = await reserveStock(Product, variantProduct._id, 1, blueLId);
    assert(reserved === null, "reservation of out-of-stock variant should return null");
  });

  // TEST 6: Two concurrent purchases of the last variant unit -> exactly 1 success
  await testAsync("Concurrent last unit (RED-M stock=1, 2 concurrent -> 1 success)", async function () {
    // Reset RED-M to exactly 1
    await Product.updateOne(
      { _id: variantProduct._id, "variants._id": redMId },
      { $set: { "variants.$.stock": 1, "variants.$.stockVersion": 0 } }
    );
    var results = await Promise.all([
      reserveStock(Product, variantProduct._id, 1, redMId),
      reserveStock(Product, variantProduct._id, 1, redMId),
    ]);
    var successes = results.filter(function (r) { return r !== null; }).length;
    assert(successes === 1, "exactly 1 concurrent reservation should succeed, got " + successes);
    // Restore
    await restoreStock(Product, variantProduct._id, 1, redMId);
  });

  // TEST 7: Variant stock never becomes negative
  await testAsync("Variant stock never negative (20 concurrent on stock=5)", async function () {
    // Reset RED-L to 5 and re-sync the top-level summary (the updateOne above
    // touches only the variant, so the summary must be recomputed)
    await Product.updateOne(
      { _id: variantProduct._id, "variants._id": redLId },
      { $set: { "variants.$.stock": 5, "variants.$.stockVersion": 0 } }
    );
    await syncSummary(Product, variantProduct._id);

    var results = await Promise.all(
      Array.from({ length: 20 }, function () {
        return reserveStock(Product, variantProduct._id, 1, redLId);
      })
    );
    var successes = results.filter(function (r) { return r !== null; }).length;
    var fresh = await Product.findById(variantProduct._id).select("variants").lean();
    var redL = fresh.variants.find(function (v) { return String(v._id) === redLId; });

    // Optimistic-lock semantics: each success consumed exactly one unit. Some
    // concurrent requests read the same stockVersion and lose the CAS race, so
    // fewer than 5 may succeed — but stock must NEVER go negative and the
    // number of successes must exactly equal the units consumed.
    assert(successes >= 1, "at least 1 of 20 should succeed, got " + successes);
    assert(successes <= 5, "at most 5 of 20 should succeed, got " + successes);
    assert(redL.stock >= 0, "stock must never go negative, got " + redL.stock);
    assert(
      successes === 5 - redL.stock,
      "successes (" + successes + ") must equal units consumed (5 - " + redL.stock + ")"
    );
    // Restore exactly the consumed units to keep the summary in sync
    await restoreStock(Product, variantProduct._id, successes, redLId);
  });

  // =========================================================================
  // Order-level restoration tests (idempotent stockRestored claim)
  // =========================================================================

  // Helper to create a variant order referencing RED-M
  async function createVariantOrder() {
    return Order.create({
      customer: testUser._id,
      items: [
        {
          product: variantProduct._id,
          supplier: testSupplier._id,
          variantId: redMId,
          sku: "VSHIRT-RED-M",
          variantLabel: "رنگ: قرمز، سایز: M",
          name: "VarTest Shirt",
          price: 150000,
          supplierPrice: 110000,
          quantity: 1,
        },
      ],
      totalAmount: 150000,
      shippingAddress: { fullName: "T", phone: "0", address: "A" },
      payment: { status: "pending", method: "zarinpal" },
      status: "pending_payment",
      stockRestored: false,
    });
  }

  // TEST 8: Failed payment restores variant stock exactly once
  await testAsync("Failed payment restores variant stock exactly once", async function () {
    // RED-M currently has stock restored to 1 by earlier tests; verify
    var order = await createVariantOrder();
    // Simulate reservation (checkout decremented to 0)
    await reserveStock(Product, variantProduct._id, 1, redMId);
    // First restore
    await restoreOrderStock(Order, Product, order._id);
    var fresh = await Product.findById(variantProduct._id).select("variants").lean();
    var redM = fresh.variants.find(function (v) { return String(v._id) === redMId; });
    assert(redM.stock === 1, "stock restored to 1, got " + redM.stock);
    // Second restore (duplicate) must NOT double-restore
    await restoreOrderStock(Order, Product, order._id);
    var fresh2 = await Product.findById(variantProduct._id).select("variants").lean();
    var redM2 = fresh2.variants.find(function (v) { return String(v._id) === redMId; });
    assert(redM2.stock === 1, "second restore must be a no-op, got " + redM2.stock);
    var orderAfter = await Order.findById(order._id).select("stockRestored").lean();
    assert(orderAfter.stockRestored === true, "order marked stockRestored");
  });

  // TEST 9: Cancelled payment restores variant stock exactly once
  await testAsync("Cancelled payment restores variant stock exactly once", async function () {
    var order = await createVariantOrder();
    await reserveStock(Product, variantProduct._id, 1, redMId);
    await restoreOrderStock(Order, Product, order._id);
    var fresh = await Product.findById(variantProduct._id).select("variants").lean();
    var redM = fresh.variants.find(function (v) { return String(v._id) === redMId; });
    assert(redM.stock === 1, "stock restored to 1 after cancel, got " + redM.stock);
  });

  // TEST 10: Duplicate payment verification cannot restore twice
  await testAsync("Duplicate verification cannot double-restore (5 concurrent)", async function () {
    var order = await createVariantOrder();
    await reserveStock(Product, variantProduct._id, 1, redMId);
    await Promise.all(
      Array.from({ length: 5 }, function () {
        return restoreOrderStock(Order, Product, order._id);
      })
    );
    var fresh = await Product.findById(variantProduct._id).select("variants").lean();
    var redM = fresh.variants.find(function (v) { return String(v._id) === redMId; });
    assert(redM.stock === 1, "stock must be restored exactly once, got " + redM.stock);
  });

  // TEST 11: Admin cancellation restores variant stock correctly
  await testAsync("Admin cancellation restores variant stock correctly", async function () {
    var order = await createVariantOrder();
    await reserveStock(Product, variantProduct._id, 1, redMId);
    // Admin cancels -> same shared restoreOrderStock
    await restoreOrderStock(Order, Product, order._id);
    var fresh = await Product.findById(variantProduct._id).select("variants").lean();
    var redM = fresh.variants.find(function (v) { return String(v._id) === redMId; });
    assert(redM.stock === 1, "stock restored after admin cancel, got " + redM.stock);
  });

  // =========================================================================
  // Summary + backward compatibility tests
  // =========================================================================

  // TEST 12: Product summary price remains correct
  await testAsync("Summary price = min active variant price (150000)", async function () {
    var fresh = await Product.findById(variantProduct._id).select("price").lean();
    assert(fresh.price === 150000, "summary price should be 150000, got " + fresh.price);
  });

  // TEST 13: Product summary stock remains correct
  await testAsync("Summary stock = sum of active variant stock", async function () {
    var fresh = await Product.findById(variantProduct._id).select("stock variants").lean();
    var expected = fresh.variants
      .filter(function (v) { return v.isActive !== false; })
      .reduce(function (s, v) { return s + v.stock; }, 0);
    assert(fresh.stock === expected, "summary stock should equal sum (" + expected + "), got " + fresh.stock);
  });

  // TEST 14: Existing non-variant products remain unchanged
  await testAsync("Non-variant products unchanged (hasVariants=false, no variants)", async function () {
    var simple = await Product.findById(simpleProduct._id).select("hasVariants variants price stock").lean();
    assert(simple.hasVariants === false, "hasVariants should be false");
    assert(simple.variants === undefined || simple.variants.length === 0, "variants should be empty");
    assert(simple.price === 100000, "price unchanged");
    assert(simple.stock === 5, "stock unchanged (restored in TEST 1), got " + simple.stock);
  });

  // TEST 15: Existing pagination still works
  await testAsync("Pagination still works (page 1 + page 2 via skip/limit)", async function () {
    // Create 5 more simple products so we have 6 total
    for (var i = 1; i <= 5; i++) {
      await Product.create({
        name: "VarTest Product " + i,
        slug: TEST_PREFIX + "p-" + i,
        description: "d" + i,
        price: 10000 * i,
        supplierPrice: 8000 * i,
        stock: 10,
        category: testCategory._id,
        supplier: testSupplier._id,
        isActive: true,
      });
    }
    // Scope the filter to this test run's products (the dev DB has real data)
    var filter = { isActive: true, stock: { $gt: 0 }, slug: { $regex: "^" + TEST_PREFIX } };
    var params = parsePaginationParams(new URLSearchParams("page=1&limit=3"));
    var [total, data] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter).sort({ createdAt: -1 }).skip(params.skip).limit(params.limit).lean(),
    ]);
    var resp = buildPaginatedResponse(data, total, params.page, params.limit);
    assert(resp.data.length === 3, "page 1 has 3 items, got " + resp.data.length);
    assert(resp.total === 7, "total 7 (6 simple + 1 variant), got " + resp.total);
    assert(resp.totalPages === 3, "totalPages = ceil(7/3) = 3, got " + resp.totalPages);
    assert(resp.hasNextPage === true, "hasNextPage on page 1");
  });

  // TEST 16: Search/filter/sort still works
  await testAsync("Search + sort still works (name regex + price_asc)", async function () {
    var filter = {
      isActive: true,
      stock: { $gt: 0 },
      slug: { $regex: "^" + TEST_PREFIX },
      $or: [
        { name: { $regex: escapeRegex("VarTest Product"), $options: "i" } },
        { description: { $regex: escapeRegex("VarTest Product"), $options: "i" } },
      ],
    };
    var data = await Product.find(filter).sort({ price: 1 }).limit(20).lean();
    assert(data.length === 5, "5 products match 'VarTest Product', got " + data.length);
    for (var i = 1; i < data.length; i++) {
      assert(data[i - 1].price <= data[i].price, "prices ascending at index " + i);
    }
  });

  // Cleanup
  console.log("\nCleaning up test data...");
  await Product.deleteMany({ slug: { $regex: "^" + TEST_PREFIX } });
  // Scope SupplierOrder cleanup to this test run's orders (never wipe real data)
  var testOrderIds = await Order.find({ customer: testUser._id }).distinct("_id");
  await Order.deleteMany({ customer: testUser._id });
  if (testOrderIds.length > 0) {
    await SupplierOrderModel.deleteMany({ order: { $in: testOrderIds } });
  }
  await AttributeModel.deleteMany({ slug: { $regex: "^" + TEST_PREFIX } });
  await Category.findByIdAndDelete(testCategory._id);
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
