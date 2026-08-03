/**
 * Session 43 — Wishlist index migration (one-off, re-runnable).
 *
 * BEFORE changing indexes (per the approved Session 43 plan):
 *   1. Verifies existing wishlist data consistency:
 *      a. no duplicate (user, product) rows (the old unique index guarantees
 *         this, but we re-check before dropping it)
 *      b. every row's variantId (if set) references a REAL, ACTIVE variant of
 *         that product (no dangling/invalid variant refs)
 *   2. Drops the old unique index { user, product } (name user_1_product_1)
 *   3. Creates the new unique index { user, product, variantId }
 *      - existing rows all have variantId: null → at most one per (user,
 *        product, null) → NO collision on current data (reviewer-confirmed)
 *      - the new index ALLOWS coexistence: product-level rows (variantId null)
 *        + variant-level rows (real variantId) for the same product
 *
 * Aborts (no index change) if any consistency check fails.
 *
 * Usage: node scripts/migrate-wishlist-index.js
 * Requires: MONGODB_URI in .env.local. Idempotent — safe to re-run.
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

const DB_NAME = "marlooai";
const OLD_INDEX = "user_1_product_1";
const NEW_INDEX_NAME = "user_1_product_1_variantId_1";

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI not set in .env.local");
    process.exit(1);
  }

  console.log("==================================================================");
  console.log("  SESSION 43 — WISHLIST INDEX MIGRATION");
  console.log("==================================================================");

  await mongoose.connect(process.env.MONGODB_URI, { dbName: DB_NAME });
  const db = mongoose.connection.db;
  const wishes = db.collection("wishlists");

  // ---- STEP 1: consistency checks (abort on failure, no index change) ----
  console.log("\n[1/3] Data consistency checks...");

  // 1a. duplicate (user, product) rows
  const dups = await wishes
    .aggregate([
      { $group: { _id: { user: "$user", product: "$product" }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
      { $limit: 10 },
    ])
    .toArray();
  if (dups.length > 0) {
    console.error("ABORT: duplicate (user, product) rows found:\n", dups);
    process.exit(1);
  }
  console.log("  - no duplicate (user, product) rows ✓");

  // 1b. any variantId set at all? (pre-Session-43 rows should all be null)
  const withVariant = await wishes.countDocuments({
    variantId: { $ne: null, $exists: true },
  });
  console.log(`  - rows with a variantId set: ${withVariant} (expected 0 pre-migration)`);

  // 1c. invalid variant references — every row with a variantId must point at a
  // real, active variant of that product. Verify against the live products.
  const rowsWithVariant = await wishes
    .find({ variantId: { $ne: null, $exists: true } })
    .project({ product: 1, variantId: 1 })
    .limit(1000)
    .toArray();

  let invalid = 0;
  for (const row of rowsWithVariant) {
    const product = await db
      .collection("products")
      .findOne({ _id: row.product }, { projection: { variants: 1 } });
    if (!product) {
      invalid++;
      continue;
    }
    const variant = (product.variants || []).find(
      (v) => String(v._id) === String(row.variantId)
    );
    if (!variant || variant.isActive === false) {
      invalid++;
      console.error(`  INVALID ref: product=${row.product} variantId=${row.variantId}`);
    }
  }
  if (invalid > 0) {
    console.error(`ABORT: ${invalid} invalid variant reference(s) found`);
    process.exit(1);
  }
  console.log("  - no invalid variant references ✓");

  // ---- STEP 2: drop the old unique index ----
  console.log("\n[2/3] Dropping old index " + OLD_INDEX + "...");
  try {
    await wishes.dropIndex(OLD_INDEX);
    console.log("  dropped ✓");
  } catch (err) {
    // Already dropped (re-run) → fine
    if (String(err.message).includes("index not found")) {
      console.log("  not present (already migrated) — skipping");
    } else {
      throw err;
    }
  }

  // ---- STEP 3: create the new unique index ----
  console.log("\n[3/3] Creating unique index { user, product, variantId }...");
  await wishes.createIndex(
    { user: 1, product: 1, variantId: 1 },
    { unique: true, name: NEW_INDEX_NAME }
  );
  console.log("  created ✓");

  const indexes = await wishes.indexes();
  console.log("\nCurrent indexes on wishlists:");
  for (const ix of indexes) {
    console.log("  -", ix.name, JSON.stringify(ix.key), ix.unique ? "(unique)" : "");
  }

  console.log("\nMigration complete. Restart the dev server (Mongoose model cache).");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("\nMigration error:", err);
  process.exit(1);
});
