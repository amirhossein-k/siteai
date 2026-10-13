/**
 * Upload configuration guard contract (image-upload regression root cause).
 *
 * The EXACT conditions that surface «سیستم آپلود پیکربندی نشده است» /
 * «مخزن آپلود پیکربندی نشده است» live ONLY in src/lib/upload.ts:
 *   - getS3Client() → null ⇐ ANY of LIARA_ENDPOINT / LIARA_ACCESS_KEY /
 *     LIARA_SECRET_KEY missing in the SERVER process → «سیستم …»
 *   - getBucketName() → "" ⇐ LIARA_BUCKET_NAME missing → «مخزن …»
 * These tests pin that contract WITHOUT touching real storage: the
 * "valid" case uses DUMMY credential VALUES against a dead loopback
 * endpoint (127.0.0.1:9, connection refused instantly), so no real
 * provider is contacted and nothing is uploaded.
 *
 * Error strings are copied from lib/upload.ts on purpose — a wording
 * change in production strings must fail here first (user-facing).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { uploadFile } from "@/lib/upload";

const SYSTEM_UNCONFIGURED = "سیستم آپلود پیکربندی نشده است";
const REPOSITORY_UNCONFIGURED = "مخزن آپلود پیکربندی نشده است";
const GENERIC_UPLOAD_ERROR =
  "خطا در آپلود فایل. لطفاً دقایقی دیگر تلاش کنید.";

const DUMMY_ENV = {
  // Dead loopback endpoint — the S3 PUT fails instantly (ECONNREFUSED);
  // no real Liara/S3 host is contacted and no credentials are valid.
  LIARA_ENDPOINT: "http://127.0.0.1:9",
  LIARA_ACCESS_KEY: "dummy-access-key",
  LIARA_SECRET_KEY: "dummy-secret-key",
  LIARA_BUCKET_NAME: "dummy-bucket",
};

/** Minimal duck-typed image file (uploadFile reads name/size/type/arrayBuffer). */
function testImageFile() {
  return {
    name: "test.png",
    size: 3,
    type: "image/png",
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  } as unknown as File;
}

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("uploadFile — configuration guards (user-facing contract)", () => {
  beforeEach(() => {
    // Start from a clean config on every case: clear all Liara vars.
    setEnv({ ...DUMMY_ENV, ...{ k: undefined } });
    setEnv({
      LIARA_ENDPOINT: undefined,
      LIARA_ACCESS_KEY: undefined,
      LIARA_SECRET_KEY: undefined,
      LIARA_BUCKET_NAME: undefined,
      LIARA_REGION: undefined,
    });
  });

  afterEach(() => {
    setEnv({
      LIARA_ENDPOINT: undefined,
      LIARA_ACCESS_KEY: undefined,
      LIARA_SECRET_KEY: undefined,
      LIARA_BUCKET_NAME: undefined,
      LIARA_REGION: undefined,
    });
  });

  it("ALL FOUR LIARA_* present (dummy values, dead endpoint) → the config gate PASSES; failure is the generic upload error, NOT «پیکربندی نشده»", async () => {
    setEnv(DUMMY_ENV);

    const result = await uploadFile(testImageFile());

    expect(result.success).toBe(false);
    expect(result.error).toBe(GENERIC_UPLOAD_ERROR);
    expect(result.error).not.toContain("پیکربندی");
  });

  it("missing LIARA_ENDPOINT (credentials/bucket present) → «سیستم آپلود پیکربندی نشده است»", async () => {
    DUMMY_ENV.LIARA_ENDPOINT = "http://127.0.0.1:9";
    setEnv({
      LIARA_ACCESS_KEY: DUMMY_ENV.LIARA_ACCESS_KEY,
      LIARA_SECRET_KEY: DUMMY_ENV.LIARA_SECRET_KEY,
      LIARA_BUCKET_NAME: DUMMY_ENV.LIARA_BUCKET_NAME,
      // LIARA_ENDPOINT deliberately absent
    });

    const result = await uploadFile(testImageFile());
    expect(result.error).toBe(SYSTEM_UNCONFIGURED);
  });

  it("missing LIARA_ACCESS_KEY → «سیستم آپلود پیکربندی نشده است»", async () => {
    setEnv({
      LIARA_ENDPOINT: DUMMY_ENV.LIARA_ENDPOINT,
      LIARA_SECRET_KEY: DUMMY_ENV.LIARA_SECRET_KEY,
      LIARA_BUCKET_NAME: DUMMY_ENV.LIARA_BUCKET_NAME,
    });

    const result = await uploadFile(testImageFile());
    expect(result.error).toBe(SYSTEM_UNCONFIGURED);
  });

  it("missing LIARA_SECRET_KEY → «سیستم آپلود پیکربندی نشده است»", async () => {
    setEnv({
      LIARA_ENDPOINT: DUMMY_ENV.LIARA_ENDPOINT,
      LIARA_ACCESS_KEY: DUMMY_ENV.LIARA_ACCESS_KEY,
      LIARA_BUCKET_NAME: DUMMY_ENV.LIARA_BUCKET_NAME,
    });

    const result = await uploadFile(testImageFile());
    expect(result.error).toBe(SYSTEM_UNCONFIGURED);
  });

  it("ALL THREE credentials present but LIARA_BUCKET_NAME missing → «مخزن آپلود پیکربندی نشده است»", async () => {
    setEnv({
      LIARA_ENDPOINT: DUMMY_ENV.LIARA_ENDPOINT,
      LIARA_ACCESS_KEY: DUMMY_ENV.LIARA_ACCESS_KEY,
      LIARA_SECRET_KEY: DUMMY_ENV.LIARA_SECRET_KEY,
      // LIARA_BUCKET_NAME deliberately absent
    });

    const result = await uploadFile(testImageFile());
    expect(result.error).toBe(REPOSITORY_UNCONFIGURED);
  });

  it("an entirely unconfigured system never reaches storage and reports the system error", async () => {
    // Everything cleared (beforeEach) — the user-visible case when the
    // SERVING process has no Liara configuration at all.
    const result = await uploadFile(testImageFile());
    expect(result.error).toBe(SYSTEM_UNCONFIGURED);
  });
});
