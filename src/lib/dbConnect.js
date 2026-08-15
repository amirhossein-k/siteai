import mongoose from "mongoose";

// ============================================================
// Centralized Model Registration
//
// All Mongoose models are registered here when this module is
// first imported. This ensures every model is available for
// `.populate()` in any API route that calls `dbConnect()`.
//
// Without this, an API route that populates a model without
// importing it first gets a MissingSchemaError.
//
// Each model file uses the safe pattern:
//   mongoose.models.Name || mongoose.model("Name", Schema)
// which prevents OverwriteModelError during hot reload.
// ============================================================
import "@/models/User";
import "@/models/Product";
import "@/models/Category";
import "@/models/Supplier";
import "@/models/Brand";
import "@/models/Tag";
import "@/models/Attribute";
import "@/models/Order";
import "@/models/SupplierOrder";
import "@/models/Notification";
import "@/models/Transaction";
import "@/models/File";
import "@/models/Wishlist";
import "@/models/Coupon";
import "@/models/CouponUsage";
import "@/models/OtpCode";
import "@/models/SupplierApplication";
import "@/models/CustomerConversation";
import "@/models/InventoryMovement";
import "@/models/AccountingConfig";
import "@/models/PurchaseOrder";
import "@/models/Expense";

const MONGODB_URI = process.env.MONGODB_URI;

let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}
export async function dbConnect() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, {
      dbName: "marlooai",
      bufferCommands: false,
    });
  }

  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (err) {
    // A rejected connect promise must NEVER stay cached — otherwise a single
    // transient failure (e.g. the DB briefly unreachable right after a machine
    // restart) poisons the whole process: every later dbConnect() call
    // re-awaits the SAME rejected promise and fails instantly, even after the
    // database is reachable again, until the dev server is restarted.
    // Reset the promise so the next call retries a fresh connection.
    cached.promise = null;
    throw err;
  }
}