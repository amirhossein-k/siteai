/**
 * Upload public-URL contract (Regression run #68 root cause).
 *
 * `uploadFile` builds the stored product URL as
 *   `${LIARA_ENDPOINT}/${bucket}/${key}`
 * where LIARA_ENDPOINT is deployed configuration — the project moved from the
 * legacy c589564.parspack.net host to c986913.parspack.net, and the E2E spec
 * previously hard-coded the OLD host, so a CORRECT upload URL failed the
 * assertion. Issue A fix: the endpoint comes from configuration and the
 * E2E spec derives its expected prefix from it.
 *
 * These tests pin the construction contract (asserted against the endpoint
 * the SERVER process was given — whatever host is configured) WITHOUT any
 * network: @aws-sdk/client-s3 is mocked, so no storage provider is contacted
 * and nothing is uploaded.
 *
 * The S3 client instance is cached module-level in src/lib/upload.ts after
 * the first successful build, so each case uses a FRESH module instance
 * (vi.resetModules) with its own env snapshot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV = {
  LIARA_ENDPOINT: "https://storage.example.test",
  LIARA_ACCESS_KEY: "test-access-key",
  LIARA_SECRET_KEY: "test-secret-key",
  LIARA_BUCKET_NAME: "test-bucket",
};

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/** Minimal duck-typed image file (uploadFile reads name/size/type/arrayBuffer). */
function testImageFile() {
  return {
    name: "photo.png",
    size: 3,
    type: "image/png",
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  } as unknown as File;
}

// Hoisted so the @aws-sdk/client-s3 factory can reach the recorder.
const s3Mock = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@aws-sdk/client-s3", () => {
  class PutObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class DeleteObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class S3Client {
    config: unknown;
    constructor(config: unknown) {
      this.config = config;
    }
    send = s3Mock.send;
  }
  return { S3Client, PutObjectCommand, DeleteObjectCommand };
});

async function loadFreshUpload() {
  // Fresh module instance per case: getS3Client() caches its client — with
  // mocked S3 that is harmless, but resetModules keeps each test hermetic.
  vi.resetModules();
  return await import("@/lib/upload");
}

describe("uploadFile — public URL construction (Issue A regression)", () => {
  beforeEach(() => {
    setEnv(ENV);
    s3Mock.send.mockReset().mockResolvedValue({ $metadata: {} });
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

  it("success URL starts with the CONFIGURED endpoint, then bucket, then the generated key", async () => {
    const { uploadFile } = await loadFreshUpload();

    const result = await uploadFile(testImageFile());

    expect(result.success).toBe(true);
    expect(result.key).toMatch(/^uploads\/image\/\d{4}\/\d{2}\/\d{2}\//);
    expect(result.url).toBe(
      `${ENV.LIARA_ENDPOINT}/${ENV.LIARA_BUCKET_NAME}/${result.key}`
    );
    // The PUT actually targeted the configured bucket/key (nothing invented).
    const putInput = (s3Mock.send.mock.calls[0]?.[0] as { input?: unknown })
      ?.input as { Bucket?: string; Key?: string } | undefined;
    expect(putInput?.Bucket).toBe(ENV.LIARA_BUCKET_NAME);
    expect(putInput?.Key).toBe(result.key);
  });

  it("a LEGACY stored URL (old host) is not produced when the configured endpoint differs", async () => {
    const { uploadFile } = await loadFreshUpload();

    const result = await uploadFile(testImageFile());

    expect(result.url).not.toContain("c589564.parspack.net");
    expect(result.url).toContain("storage.example.test");
  });
});

describe("getKeyFromUrl — round-trip with the configured endpoint", () => {
  beforeEach(() => setEnv(ENV));

  afterEach(() => {
    setEnv({
      LIARA_ENDPOINT: undefined,
      LIARA_ACCESS_KEY: undefined,
      LIARA_SECRET_KEY: undefined,
      LIARA_BUCKET_NAME: undefined,
      LIARA_REGION: undefined,
    });
  });

  it("round-trips a URL built by uploadFile back to its S3 key", async () => {
    const { getKeyFromUrl } = await loadFreshUpload();

    const url = `${ENV.LIARA_ENDPOINT}/${ENV.LIARA_BUCKET_NAME}/uploads/image/2026/10/27/abc-photo.png`;
    expect(getKeyFromUrl(url)).toBe(
      "uploads/image/2026/10/27/abc-photo.png"
    );
  });

  it("rejects URLs from a foreign (stale/hostile) host", async () => {
    const { getKeyFromUrl } = await loadFreshUpload();

    const foreign = "https://legacy.example.test/test-bucket/uploads/image/x.png";
    expect(getKeyFromUrl(foreign)).toBeNull();
  });
});
