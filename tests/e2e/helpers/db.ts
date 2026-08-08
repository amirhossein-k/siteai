import fs from "fs";
import path from "path";
import mongoose from "mongoose";

/**
 * Load .env.local into process.env (same convention as the verify scripts and
 * run-regression.js: never overwrite an already-set variable).
 */
export function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}


/**
 * E2E MongoDB helpers — direct cleanup of PREFIX'd fixture rows.
 *
 * Every fixture created through the real APIs in these journeys is tagged with
 * a per-run PREFIX (on phone numbers, slugs, names, coupon codes and SKUs) so
 * the teardown can remove exactly what the run created — the same convention
 * the 33 regression suites follow (self-cleaning, shared `marlooai` DB).
 *
 * The cleanup intentionally deletes ONLY rows matching the E2E prefix
 * (`e2e_<ts>_`) — real dev data and regression-suite data are never touched.
 */

export const DB_NAME = "marlooai";

/** Connect to the shared dev database (marlooai — same as dbConnect.js). */
export async function connectDb(): Promise<void> {
  loadEnv();
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not set (missing .env.local?)");
  }
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: DB_NAME });
  }
}

export async function disconnectDb(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

/**
 * Remove every E2E-created row whose identifier starts with `prefix`.
 *
 * ObjectId `_id` fields CANNOT be regex-matched in MongoDB, so the pattern is:
 * resolve id sets from string fields (slug/code/phone/name/businessName) first,
 * then delete by `_id: { $in }`. Referential rows (orders, supplierorders,
 * transactions, notifications, wishlists, couponusages) are resolved through
 * the customer/supplier/coupon id sets.
 */
export async function cleanupByPrefix(prefix: string): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Not connected to MongoDB");

  // Users/suppliers embed the run prefix MID-string ("مشتری e2e_<ts>_",
  // "فروشنده e2e_<ts>_") and phones/contactPhones carry no prefix at all, so
  // name/businessName matching must be unanchored. Slug/code fields DO start
  // with the prefix (we seed them that way) → anchored regexes for those.
  const re = new RegExp(prefix);
  const anchoredRe = new RegExp(`^${prefix}`);
  // Coupon codes are uppercased+trimmed by the server (normalizeCouponCode),
  // so `E2E_...` must also match the lowercase run prefix `e2e_...`.
  const couponRe = new RegExp(`^${prefix}`, "i");

  // --- Resolve id sets from string fields ---
  const [userRows, supplierRows, couponRows, productRows] = await Promise.all([
    db
      .collection("users")
      .find({ $or: [{ phone: { $regex: re } }, { name: { $regex: re } }] })
      .project({ _id: 1 })
      .toArray(),
    db
      .collection("suppliers")
      .find({
        $or: [
          { businessName: { $regex: re } },
          { contactPhone: { $regex: re } },
        ],
      })
      .project({ _id: 1 })
      .toArray(),
    db.collection("coupons").find({ code: { $regex: couponRe } }).project({ _id: 1 }).toArray(),
    db.collection("products").find({ slug: { $regex: anchoredRe } }).project({ _id: 1 }).toArray(),
  ]);

  const userIds = userRows.map((r) => r._id as mongoose.Types.ObjectId);
  const supplierIds = supplierRows.map((r) => r._id as mongoose.Types.ObjectId);
  const couponIds = couponRows.map((r) => r._id as mongoose.Types.ObjectId);
  const productIds = productRows.map((r) => r._id as mongoose.Types.ObjectId);

  // Suppliers may also be linked via the user ref (auto-created Supplier doc
  // for a PREFIX'd supplier user whose businessName carries no prefix).
  if (userIds.length > 0) {
    const linked = await db
      .collection("suppliers")
      .find({ user: { $in: userIds } })
      .project({ _id: 1 })
      .toArray();
    for (const r of linked) {
      if (!supplierIds.some((id) => id.equals ? id.equals(r._id) : String(id) === String(r._id))) {
        supplierIds.push(r._id);
      }
    }
  }

  // Orders of PREFIX'd customers (customer is an ObjectId ref).
  let orderIds: mongoose.Types.ObjectId[] = [];
  if (userIds.length > 0) {
    const orderRows = await db
      .collection("orders")
      .find({ customer: { $in: userIds } })
      .project({ _id: 1 })
      .toArray();
    orderIds = orderRows.map((r) => r._id as mongoose.Types.ObjectId);
  }

  // --- Delete (children before parents is not required in Mongo, but tidy) ---
  const deletes: Promise<unknown>[] = [];
  if (couponIds.length > 0) {
    deletes.push(
      db.collection("couponusages").deleteMany({ coupon: { $in: couponIds } }),
      db.collection("coupons").deleteMany({ _id: { $in: couponIds } })
    );
  }
  if (supplierIds.length > 0) {
    deletes.push(
      db.collection("transactions").deleteMany({ supplier: { $in: supplierIds } }),
      db.collection("suppliers").deleteMany({ _id: { $in: supplierIds } })
    );
  }
  // Session 67 — supplier applications of PREFIX'd users (applications carry
  // no prefix on their own fields, so they are resolved through the user ref).
  if (userIds.length > 0) {
    deletes.push(
      db.collection("supplierapplications").deleteMany({ user: { $in: userIds } })
    );
  }
  if (orderIds.length > 0) {
    deletes.push(
      db.collection("supplierorders").deleteMany({ order: { $in: orderIds } }),
      db.collection("orders").deleteMany({ _id: { $in: orderIds } })
    );
  }
  if (userIds.length > 0) {
    deletes.push(
      db.collection("wishlists").deleteMany({ user: { $in: userIds } }),
      db.collection("notifications").deleteMany({ recipient: { $in: userIds } }),
      db.collection("couponusages").deleteMany({ user: { $in: userIds } }),
      db.collection("users").deleteMany({ _id: { $in: userIds } })
    );
  }
  if (productIds.length > 0) {
    deletes.push(db.collection("products").deleteMany({ _id: { $in: productIds } }));
  }

  // Slug-prefixed catalogs (anchored — slugs start with the run prefix).
  deletes.push(
    db.collection("categories").deleteMany({ slug: { $regex: anchoredRe } }),
    db.collection("attributes").deleteMany({ slug: { $regex: anchoredRe } }),
    db.collection("brands").deleteMany({ slug: { $regex: anchoredRe } }),
    db.collection("tags").deleteMany({ slug: { $regex: anchoredRe } })
  );

  await Promise.all(deletes);
}

/**
 * Reset the shared login/register rate-limiter keys accumulated during E2E
 * logins — the exact Session 52 convention the regression runner uses. The
 * production limiter logic is untouched; only test-state keys are cleared.
 */
export async function clearRateLimiterKeys(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) return;
  // The limiter stores its keys in `_id` as plain strings — type the
  // collection accordingly so the `$regex` filter type-checks. Session 62
  // extends the sweep with the OTP request/verify keys so the OTP journey
  // (and the nightly verify-otp suite) always starts with clean counters.
  await db.collection<{ _id: string }>("ratelimits").deleteMany({
    _id: {
      $regex:
        "^rl:(login|login_ip|register|otp_request|otp_request_ip|otp_verify|supplier-apply|supplier-application-decide):",
    },
  });
}
