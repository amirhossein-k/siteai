import mongoose from "mongoose";

const FileSchema = new mongoose.Schema(
  {
    // Public URL of the file
    url: {
      type: String,
      required: true,
    },
    // S3 key for deletion
    key: {
      type: String,
      required: true,
    },
    // Original file name
    name: {
      type: String,
      required: true,
    },
    // File size in bytes
    size: {
      type: Number,
      required: true,
    },
    // MIME type
    mimeType: {
      type: String,
      required: true,
    },
    // File category: image | video | document
    category: {
      type: String,
      enum: ["image", "video", "document"],
      required: true,
    },
    // Who uploaded the file (User ID)
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Optional reference to a product
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.models.File || mongoose.model("File", FileSchema);
