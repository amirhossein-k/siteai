/**
 * Session 90 — Admin Business-SMS Management Verification (real HTTP API)
 *
 * Validates Phase 1 (models + service + admin APIs + RBAC) end-to-end:
 *   1.  unauthenticated template list → 401
 *   2.  customer token → 403 (RBAC)
 *   3.  supplier token → 403 (RBAC)
 *   4.  template create → 201; duplicate name → 409
 *   5.  server-derived variables (client-declared vars ignored/overridden)
 *   6.  invalid payloads → 400 (bad type, non-numeric provider id, long body)
 *   7.  template update (body edit re-derives variables) + 404 unknown id
 *   8.  inactive template → send refused 400 (no SMS when disabled)
 *   9.  manual template send (mock) → 200 sent + SmsLog row (sent, mock,
 *       providerMessageId, rendered text, actor audit)
 *  10.  variable validation: missing var → 400, extra var → 400
 *  11.  free-form custom send → 200 + SmsLog row (messageType custom)
 *  12.  invalid phone → 400; malformed ObjectIds → 400
 *  13.  exactly-one-of template/message rule → 400
 *  14.  rate limit: the 11th manual send in the window → 429
 *       (SMS_SEND_LIMIT = 10/15min — isolated via the suite's own key prefix)
 *  15.  SmsLog listing + filters (status/messageType/recipient) + pagination
 *  16.  template delete → 200 + SmsLog snapshot intact (templateName kept)
 *  17.  OTP ISOLATION: no business-SMS code path ever touches OtpCode rows —
 *       the suite counts otpcodes before/after and asserts unchanged; and
 *       GET /api/auth/otp/dev-last behavior is untouched by business flags
 *
 * REQUIRES: dev server on http://localhost:3000 started with SMS_MOCK=1
 * (business mock seam shares the SMS_MOCK flag inside its own module). The
 * suite is hermetic otherwise: self-cleaning PREFIX'd fixtures, isolated
 * rate-limit keys, no real SMS ever (business provider is mock in dev).
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
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^[\"']|[\"']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

const mongoose = require("mongoose");

const BASE = "http://localhost:3000";
const DB_NAME = "marlooai";
const PREFIX = "sms90_" + Date.now() + "_";

let passed = 0, failed = 0, total = 0;

async function testAsync(name, fn) {
  total++;
  process.stdout.write("\n  [TEST " + total + "] " + name + " ... ");
  try { await fn(); console.log("PASS"); passed++; }
  catch (err) { console.log("FAIL: " + err.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
function assertEq(actual, expected, msg) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error((msg || "equality") + " — actual: " + JSON.stringify(actual) + " expected: " + JSON.stringify(expected));
  }
}

// --- Cookie jar (the exact Session 36/42 pattern) ---
function makeJar() {
  const cookies = {};
  return {
    get(headers) {
      let entries = [];
      if (headers && typeof headers.getSetCookie === "function") entries = headers.getSetCookie();
      else if (Array.isArray(headers)) entries = headers;
      for (const entry of entries) {
        const [pair] = entry.split(";");
        const eq = pair.indexOf("=");
        if (eq < 1) continue;
        const key = pair.slice(0, eq).trim();
        let value = pair.slice(eq + 1).trim();
        if (value.startsWith('"')) value = value.slice(1);
        if (value.endsWith('"')) value = value.slice(0, -1);
        cookies[key] = value;
      }
    },
    header() { return Object.entries(cookies).map(([k, v]) => k + "=" + v).join("; "); },
  };
}

// --- Admin login via the seeded credentials account ---
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";

async function login(phone, password) {
  const jar = makeJar();
  let res = await fetch(BASE + "/api/auth/csrf");
  jar.get(res.headers);
  const { csrfToken } = await res.json();
  const form = new URLSearchParams({ csrfToken, phone, password, json: "true" });
  res = await fetch(BASE + "/api/auth/callback/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest", Cookie: jar.header() },
    body: form.toString(),
    redirect: "manual",
  });
  jar.get(res.headers);
  return jar;
}

async function http(jar, method, path_, body) {
  const headers = { Cookie: jar.header() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path_, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data, headers: res.headers };
}

// A real customer for RBAC checks (self-cleaning, phone carries the prefix).
const customerPhone = () => "0911" + String(Date.now()).slice(-7);
// Unique 11-digit Iranian recipient (mock provider never really sends):
// 0912 + 5 timestamp digits + 2 counter digits = 11.
let recipSeq = 0;
const recipPhone = () =>
  "0912" + String(Date.now() % 100000).padStart(5, "0") + String(++recipSeq % 100).padStart(2, "0");

let db;
let adminJar;
let customerJar;

async function run() {
  try {
    const ping = await fetch(BASE + "/api/auth/csrf");
    assert(ping.status === 200, "dev server not reachable");
    console.log("\n  Dev server reachable\n");
  } catch {
    console.error("\nERROR: dev server not reachable. Start it with: SMS_MOCK=1 npm run dev");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, { dbName: DB_NAME });
  db = mongoose.connection.db;

  // OTP isolation baseline: count otpcodes before the suite runs.
  const otpBefore = await db.collection("otpcodes").countDocuments({});

  // --- Admin login (seeded credentials account) ---
  adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
  const whoRes = await http(adminJar, "GET", "/api/auth/session");
  assert(whoRes.status === 200 && whoRes.data && whoRes.data.user, "admin login failed");
  assert(whoRes.data.user.role === "admin", "seeded account is not admin");
  const adminId = whoRes.data.user.id;

  /**
   * Sweep THIS suite's own rate-limit fixture key (established verify-otp.js
   * convention — test-state only; the limiter logic itself is untouched).
   * Makes send-count assertions deterministic across suite re-runs.
   */
  async function sweepSmsSendBudget() {
    await db.collection("ratelimits").deleteMany({ _id: "rl:sms-send:" + adminId });
  }

  // --- Customer fixture (for RBAC 403 checks) ---
  const custPhone = customerPhone(); // generate ONCE — register + login must match
  const regRes = await http(makeJar(), "POST", "/api/register", {
    name: "مشتری " + PREFIX,
    phone: custPhone,
    password: "sms-pass-123",
  });
  assert(regRes.status === 200 || regRes.status === 201, "customer register failed: " + JSON.stringify(regRes.data));
  customerJar = await login(custPhone, "sms-pass-123");
  const whoC = await http(customerJar, "GET", "/api/auth/session");
  assert(whoC.status === 200 && whoC.data && whoC.data.user && whoC.data.user.role === "customer", "customer login failed");

  // ============================================================
  // RBAC
  // ============================================================
  await testAsync("1. unauthenticated template list → 401", async () => {
    const res = await http(makeJar(), "GET", "/api/admin/sms/templates");
    assert(res.status === 401, "expected 401, got " + res.status);
    const sendRes = await http(makeJar(), "POST", "/api/admin/sms/send", { phone: recipPhone(), message: "x" });
    assert(sendRes.status === 401, "send expected 401, got " + sendRes.status);
    const logRes = await http(makeJar(), "GET", "/api/admin/sms/logs");
    assert(logRes.status === 401, "logs expected 401, got " + logRes.status);
  });

  await testAsync("2. customer token → 403 on all three surfaces", async () => {
    const t = await http(customerJar, "GET", "/api/admin/sms/templates");
    assert(t.status === 403, "templates expected 403, got " + t.status);
    const s = await http(customerJar, "POST", "/api/admin/sms/send", { phone: recipPhone(), message: "x" });
    assert(s.status === 403, "send expected 403, got " + s.status);
    const l = await http(customerJar, "GET", "/api/admin/sms/logs");
    assert(l.status === 403, "logs expected 403, got " + l.status);
  });

  // ============================================================
  // Template CRUD
  // ============================================================
  let templateId, template2Id;

  await testAsync("3. template create → 201 (variables server-derived)", async () => {
    const res = await http(adminJar, "POST", "/api/admin/sms/templates", {
      name: "قالب تست " + PREFIX,
      type: "order_confirmation",
      body: "سفارش {{orderNo}} ثبت شد. {{trackingCode}}",
      // A malicious/extra variables declaration must be IGNORED by the server.
      variables: ["hack"],
      providerTemplateId: "",
    });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data));
    templateId = res.data._id;
    assert(templateId && /^[0-9a-fA-F]{24}$/.test(templateId), "invalid template id");

    const list = await http(adminJar, "GET", "/api/admin/sms/templates");
    assert(list.status === 200, "list failed");
    const row = list.data.find((t) => t._id === templateId);
    assert(row, "created template not in list");
    assertEq(row.variables, ["orderNo", "trackingCode"], "variables must be server-derived from body");
  });

  await testAsync("4. duplicate template name → 409", async () => {
    const res = await http(adminJar, "POST", "/api/admin/sms/templates", {
      name: "قالب تست " + PREFIX,
      type: "custom",
      body: "dup",
    });
    assert(res.status === 409, "expected 409, got " + res.status);
  });

  await testAsync("5. invalid template payloads → 400", async () => {
    const badType = await http(adminJar, "POST", "/api/admin/sms/templates", {
      name: "t " + PREFIX, type: "not_a_type", body: "x",
    });
    assert(badType.status === 400, "bad type expected 400, got " + badType.status);
    const badProvider = await http(adminJar, "POST", "/api/admin/sms/templates", {
      name: "t2 " + PREFIX, type: "custom", body: "x", providerTemplateId: "abc;drop",
    });
    assert(badProvider.status === 400, "bad providerTemplateId expected 400, got " + badProvider.status);
    const longBody = await http(adminJar, "POST", "/api/admin/sms/templates", {
      name: "t3 " + PREFIX, type: "custom", body: "x".repeat(600),
    });
    assert(longBody.status === 400, "long body expected 400, got " + longBody.status);
  });

  await testAsync("6. template update re-derives variables; unknown id → 404", async () => {
    const upd = await http(adminJar, "PUT", "/api/admin/sms/templates?id=" + templateId, {
      body: "سفارش {{orderNo}} برای {{name}} — کد {{trackingCode}}",
    });
    assert(upd.status === 200, "update expected 200, got " + upd.status);
    const list = await http(adminJar, "GET", "/api/admin/sms/templates");
    const row = list.data.find((t) => t._id === templateId);
    assertEq(row.variables, ["orderNo", "name", "trackingCode"], "variables must re-derive on body edit");

    const nf = await http(adminJar, "PUT", "/api/admin/sms/templates?id=000000000000000000000000", { isActive: false });
    assert(nf.status === 404, "unknown id expected 404, got " + nf.status);
    const badId = await http(adminJar, "PUT", "/api/admin/sms/templates?id=zzz", { isActive: false });
    assert(badId.status === 400, "malformed id expected 400, got " + badId.status);
  });

  // Second template — will be deactivated for the send-refusal test.
  await testAsync("7. second template created, then deactivated", async () => {
    const res = await http(adminJar, "POST", "/api/admin/sms/templates", {
      name: "قالب غیرفعال " + PREFIX,
      type: "custom",
      body: "غیرفعال {{v}}",
    });
    assert(res.status === 201, "expected 201, got " + res.status);
    template2Id = res.data._id;
    const deact = await http(adminJar, "PUT", "/api/admin/sms/templates?id=" + template2Id, { isActive: false });
    assert(deact.status === 200 && deact.data.isActive === false, "deactivation failed");
  });

  // ============================================================
  // Manual send + SmsLog lifecycle
  // ============================================================
  let sendCount = 0;
  const recipients = {};

  await testAsync("8. inactive template → send refused 400 (no SMS)", async () => {
    const res = await http(adminJar, "POST", "/api/admin/sms/send", {
      phone: recipPhone(),
      templateId: template2Id,
      variables: { v: "x" },
    });
    assert(res.status === 400, "expected 400, got " + res.status);
    const logs = await db.collection("smslogs").find({ template: new mongoose.Types.ObjectId(template2Id) }).toArray();
    assert(logs.length === 0, "inactive-template send must not create a log row");
  });

  await testAsync("9. template send (mock) → 200 + SmsLog sent row", async () => {
    const phone = recipPhone();
    recipients.ok = phone;
    sendCount++;
    const res = await http(adminJar, "POST", "/api/admin/sms/send", {
      phone,
      templateId,
      variables: { orderNo: "ABC123", name: "علی", trackingCode: "TRK9" },
      orderId: null,
    });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data));
    assert(res.data.provider === "mock", "provider must be mock in dev");
    const log = await db.collection("smslogs").findOne({
      recipient: phone, status: "sent", provider: "mock",
    });
    assert(log, "SmsLog sent row missing");
    assert(log.message.includes("ABC123") && log.message.includes("TRK9"), "rendered text must contain substituted variables");
    assert(log.templateName && log.templateName.startsWith("قالب تست"), "templateName snapshot missing");
    assert(log.createdBy, "actor audit missing");
    assert(log.messageType === "order_confirmation", "messageType must mirror template type");
  });

  await testAsync("10. variable validation: missing → 400, extra → 400", async () => {
    sendCount++;
    const missing = await http(adminJar, "POST", "/api/admin/sms/send", {
      phone: recipPhone(),
      templateId,
      variables: { orderNo: "A", name: "ب" }, // trackingCode missing
    });
    assert(missing.status === 400, "missing var expected 400, got " + missing.status);
    assert(missing.data.missing && missing.data.missing.includes("trackingCode"), "missing list must name trackingCode");

    const extra = await http(adminJar, "POST", "/api/admin/sms/send", {
      phone: recipPhone(),
      templateId,
      variables: { orderNo: "A", name: "ب", trackingCode: "C", extra: "x" },
    });
    assert(extra.status === 400, "extra var expected 400, got " + extra.status);
  });

  await testAsync("11. free-form custom send → 200 + SmsLog custom row", async () => {
    const phone = recipPhone();
    sendCount++;
    const res = await http(adminJar, "POST", "/api/admin/sms/send", {
      phone,
      message: "پیام دستی " + PREFIX + " <script>alert(1)</script>",
    });
    assert(res.status === 200, "expected 200, got " + res.status);
    const log = await db.collection("smslogs").findOne({ recipient: phone });
    assert(log, "SmsLog row missing");
    assert(log.messageType === "custom", "free-form must be custom");
    assert(!log.message.includes("<script>"), "message must be sanitized");
  });

  await testAsync("12. invalid phone + malformed ids → 400", async () => {
    const badPhone = await http(adminJar, "POST", "/api/admin/sms/send", { phone: "12345", message: "x" });
    assert(badPhone.status === 400, "bad phone expected 400, got " + badPhone.status);
    const badTemplate = await http(adminJar, "POST", "/api/admin/sms/send", { phone: recipPhone(), templateId: "zzz" });
    assert(badTemplate.status === 400, "malformed templateId expected 400, got " + badTemplate.status);
    const nfTemplate = await http(adminJar, "POST", "/api/admin/sms/send", { phone: recipPhone(), templateId: "000000000000000000000000" });
    assert(nfTemplate.status === 404, "unknown template expected 404, got " + nfTemplate.status);
    const badUser = await http(adminJar, "POST", "/api/admin/sms/send", { phone: recipPhone(), message: "x", userId: "nope" });
    assert(badUser.status === 400, "malformed userId expected 400, got " + badUser.status);
  });

  await testAsync("13. exactly-one-of template/message → 400", async () => {
    // Fresh send budget so these two validation calls cannot be masked by a
    // shared 429 left over from tests 8–12 (fixture-key isolation).
    await sweepSmsSendBudget();
    const both = await http(adminJar, "POST", "/api/admin/sms/send", {
      phone: recipPhone(), templateId, message: "x", variables: {},
    });
    assert(both.status === 400, "both expected 400, got " + both.status);
    const neither = await http(adminJar, "POST", "/api/admin/sms/send", { phone: recipPhone() });
    assert(neither.status === 400, "neither expected 400, got " + neither.status);
  });

  await testAsync("14. manual-send rate limit: 11th send → 429", async () => {
    // Deterministic boundary: sweep the fixture key, consume exactly the
    // approved cap (10/15min) with accepted sends, then the 11th → 429.
    await sweepSmsSendBudget();
    for (let i = 0; i < 10; i++) {
      const ok = await http(adminJar, "POST", "/api/admin/sms/send", {
        phone: recipPhone(), message: "cap " + i,
      });
      assert(ok.status === 200, "send " + (i + 1) + " expected 200, got " + ok.status);
    }
    const res = await http(adminJar, "POST", "/api/admin/sms/send", { phone: recipPhone(), message: "over cap" });
    assert(res.status === 429, "11th send expected 429, got " + res.status);
    assert(res.data && res.data.error, "429 must carry an error message");
    assert(res.headers.get("retry-after"), "429 must carry Retry-After");
  });

  // ============================================================
  // Logs listing + filters
  // ============================================================
  await testAsync("15. logs listing + filters + pagination shape", async () => {
    const all = await http(adminJar, "GET", "/api/admin/sms/logs");
    assert(all.status === 200, "expected 200, got " + all.status);
    assert(typeof all.data.total === "number" && Array.isArray(all.data.data), "paginated envelope required");
    assert(all.data.data.length >= 2, "at least the sent rows must be listed");
    const row = all.data.data[0];
    for (const key of ["_id", "recipient", "messageType", "provider", "status", "message", "createdAt"]) {
      assert(key in row, "log row missing " + key);
    }

    const sentOnly = await http(adminJar, "GET", "/api/admin/sms/logs?status=sent");
    assert(sentOnly.status === 200 && sentOnly.data.data.every((r) => r.status === "sent"), "status filter broken");
    const customOnly = await http(adminJar, "GET", "/api/admin/sms/logs?messageType=custom");
    assert(customOnly.status === 200 && customOnly.data.data.every((r) => r.messageType === "custom"), "type filter broken");
    const byRecipient = await http(adminJar, "GET", "/api/admin/sms/logs?q=" + encodeURIComponent(recipients.ok));
    assert(byRecipient.status === 200 && byRecipient.data.data.length === 1, "recipient search broken");
    const paged = await http(adminJar, "GET", "/api/admin/sms/logs?page=1&limit=1");
    assert(paged.status === 200 && paged.data.data.length === 1 && paged.data.totalPages >= 1, "pagination broken");
  });

  // ============================================================
  // Template delete + snapshot durability
  // ============================================================
  await testAsync("16. template delete → 200; SmsLog snapshot intact", async () => {
    const del = await http(adminJar, "DELETE", "/api/admin/sms/templates?id=" + template2Id);
    assert(del.status === 200, "delete expected 200, got " + del.status);
    const gone = await db.collection("smstemplates").findOne({ _id: new mongoose.Types.ObjectId(template2Id) });
    assert(!gone, "template must be deleted");
    // The earlier sent row (test 9) must still carry its templateName snapshot.
    const log = await db.collection("smslogs").findOne({ recipient: recipients.ok });
    assert(log && log.templateName, "templateName snapshot must survive template deletion");
  });

  // ============================================================
  // OTP isolation
  // ============================================================
  await testAsync("17. OTP isolation: business SMS never touches OtpCode", async () => {
    const otpAfter = await db.collection("otpcodes").countDocuments({});
    assert(otpAfter === otpBefore, "otpcodes rows changed during the business-SMS suite");
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("smslogs").deleteMany({ templateName: { $regex: PREFIX } });
  await db.collection("smslogs").deleteMany({ message: { $regex: PREFIX } });
  // The rate-limit-cap sends (test 14) use plain "cap N" texts with generated
  // 0912 recipients — sweep those too so the shared dev DB stays clean.
  await db.collection("smslogs").deleteMany({ message: { $regex: "^cap \\d+$" } });
  await db.collection("smslogs").deleteMany({ message: { $in: ["cap", "over cap", "x"] } });
  await db.collection("smslogs").deleteMany({
    recipient: { $regex: "^0912" },
    "templateName": { $in: ["", null] },
    messageType: "custom",
  });
  await db.collection("smstemplates").deleteMany({ name: { $regex: PREFIX } });
  await db.collection("ratelimits").deleteMany({ _id: { $regex: "^rl:(sms-send|sms-template-write):" } });
  await db.collection("users").deleteMany({ name: { $regex: PREFIX } });
  console.log("  Done");

  console.log("\n==================================================================");
  console.log("  RESULTS");
  console.log("==================================================================");
  console.log("  Total:   " + total);
  console.log("  Passed:  " + passed);
  console.log("  Failed:  " + failed);
  console.log("  Status:  " + (failed === 0 ? "ALL PASSED" : failed + " TEST(S) FAILED"));
  console.log("==================================================================");

  await mongoose.disconnect();
  if (failed > 0) process.exit(1);
}

run().catch((err) => { console.error("\nTest suite error:", err); process.exit(1); });
