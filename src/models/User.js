import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      unique: true, // با این ستون توی auth.js لاگین می‌شه
      trim: true,
    },
    // Session 62 — optional: OTP-registered customers have no password
    // (they sign in exclusively via SMS OTP). Password users keep their hash;
    // the login path treats a missing hash as "cannot password-login".
    passwordHash: {
      type: String,
      default: null,
    },
    // Session 62 — session-revocation foundation: bumping this number
    // invalidates all previously-issued JWTs for the user (checked by a
    // FUTURE session; stored in the token at sign-in). Defaults to 0.
    tokenVersion: {
      type: Number,
      default: 0,
    },
    role: {
      type: String,
      enum: ["customer", "supplier", "admin"],
      default: "customer",
    },
    // اگه role === "supplier" باشه، این فیلد به مدل Supplier وصل می‌شه
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      default: null,
    },
    address: {
      type: String,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

export default mongoose.models.User || mongoose.model("User", UserSchema);
