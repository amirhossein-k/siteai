import mongoose from "mongoose";

const EnamadSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: "footer" },
    enabled: { type: Boolean, default: false },
    code: { type: String, default: "", trim: true, maxlength: 20_000 },
    altText: { type: String, default: "نماد اعتماد الکترونیکی", trim: true, maxlength: 120 },
  },
  { timestamps: true }
);

export default mongoose.models.EnamadSettings ||
  mongoose.model("EnamadSettings", EnamadSettingsSchema);
