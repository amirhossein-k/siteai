/**
 * Session 56 — Backfill Product.soldCount from historical PAID orders.
 *
 * OPTIONAL one-time data migration (NOT part of the regression runner).
 * Computes units sold per product from ALL paid orders
 * (`payment.status === "paid"` — refunds flip the status to "refunded", so
 * refunded units are automatically excluded; cancelled/failed orders were
 * never paid and never carry this status) and SETS soldCount to the computed
 * value — idempotent by construction: re-running overwrites with the same
 * recomputed numbers.
 *
 * Products absent from the aggregation (never sold) are left untouched
 * (their default soldCount = 0 already applies).
 *
 * Usage: node scripts/backfill-sold-count.js
 * Requires: MONGODB_URI in .env.local. Safe to re-run.
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

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error("ERROR: MONGODB_URI not found in .env.local");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI, { dbName: DB_NAME });
  const db = mongoose.connection.db;

  // Units sold per product from paid, non-refunded, non-cancelled orders only
  // (Session 56 semantics — admin cancellation of a paid order also reverses
  // the live counter, so the backfill must exclude cancelled orders too).
  const rows = await db
    .collection("orders")
    .aggregate([
      { $match: { "payment.status": "paid", status: { $ne: "cancelled" } } },
      { $unwind: "$items" },
      // Items may hold a null product ref for deleted products — skip them.
      { $match: { "items.product": { $type: "objectId" } } },
      {
        $group: {
          _id: "$items.product",
          sold: { $sum: { $ifNull: ["$items.quantity", 0] } },
        },
      },
    ])
    .toArray();

  const ops = rows
    .filter((r) => r._id && r.sold > 0)
    .map((r) => ({
      updateOne: {
        filter: { _id: r._id },
        update: { $set: { soldCount: r.sold } },
      },
    }));

  if (ops.length === 0) {
    console.log("No paid orders to backfill — nothing to do.");
    await mongoose.disconnect();
    return;
  }

  const res = await db
    .collection("products")
    .bulkWrite(ops, { ordered: false });

  console.log(
    `Backfilled soldCount for ${ops.length} product(s) ` +
      `(matched ${res.matchedCount}, modified ${res.modifiedCount}).`
  );

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
