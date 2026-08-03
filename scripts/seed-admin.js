/**
 * Seed Script — Create Default Admin Account
 *
 * Usage:
 *   node scripts/seed-admin.js
 *
 * Environment Variables (from .env.local):
 *   MONGODB_URI  — Required. MongoDB connection string.
 *   ADMIN_SEED_PHONE     — Optional. Admin phone (default: 09120000000)
 *   ADMIN_SEED_PASSWORD  — Optional. Admin password (default: admin123456)
 *   ADMIN_SEED_NAME      — Optional. Admin name (default: مدیر سیستم)
 *
 * This script inserts an admin user if one doesn't already exist.
 * It is safe to run multiple times — it will skip if an admin with the
 * same phone already exists.
 */

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");

// --- Load .env.local manually (dotenv not installed) ---
const envPath = path.resolve(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI is not set.");
  console.error("");
  console.error("   Create a .env.local file in the project root with:");
  console.error("   MONGODB_URI=mongodb://...");
  console.error("");
  console.error("   See .env.example for reference.");
  process.exit(1);
}

const ADMIN_PHONE = process.env.ADMIN_SEED_PHONE || "09120000000";
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD || "admin123456";
const ADMIN_NAME = process.env.ADMIN_SEED_NAME || "مدیر سیستم";

async function seed() {
  console.log("🔌 Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI, { dbName: "marlooai" });
  console.log("✅ Connected to marlooai database\n");

  // Dynamically get the User model from the project
  const User = require(path.resolve(__dirname, "..", "src/models/User.js")).default;

  // Check if admin already exists
  const existing = await User.findOne({ phone: ADMIN_PHONE });
  if (existing) {
    console.log(`ℹ️  Admin with phone "${ADMIN_PHONE}" already exists. Skipping.`);
    console.log(`   Name: ${existing.name}`);
    console.log(`   Role: ${existing.role}`);
    console.log(`   ID:   ${existing._id}`);
    await mongoose.disconnect();
    return;
  }

  // Create admin user
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const admin = await User.create({
    name: ADMIN_NAME,
    phone: ADMIN_PHONE,
    passwordHash,
    role: "admin",
    isActive: true,
    address: "",
  });

  console.log("✅ Default admin account created successfully!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`   Name:     ${ADMIN_NAME}`);
  console.log(`   Phone:    ${ADMIN_PHONE}`);
  console.log(`   Password: ${ADMIN_PASSWORD}`);
  console.log(`   Role:     admin`);
  console.log(`   ID:       ${admin._id}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("⚠️  CHANGE THE DEFAULT PASSWORD AFTER FIRST LOGIN!\n");

  await mongoose.disconnect();
  console.log("🔌 Disconnected from MongoDB");
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
