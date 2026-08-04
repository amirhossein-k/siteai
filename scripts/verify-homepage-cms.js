/**
 * Session 53 — Homepage CMS Verification (real HTTP API + real MongoDB)
 *
 * Covers (against the real running Next.js API + real DB):
 *   1. Server reachable + admin login
 *   2. Authz: unauth 401, supplier 403 on admin homepage endpoints
 *   3. Sections bootstrap: GET /api/admin/homepage/sections seeds the default
 *      9 sections + static-config content (idempotent)
 *   4. Public composition: GET /api/homepage returns sections in sortOrder,
 *      content rows carry only public fields (leak scan)
 *   5. Unknown registry component does NOT crash the homepage — a section
 *      with a bogus `component` is skipped by the public API and GET / still
 *      returns 200 HTML
 *   6. Multiple sections using the SAME renderer component work — each keeps
 *      its own content scoped by sectionSlug
 *   7. slug/component immutability — PUT attempting to change either → 400
 *   8. Section visibility — enabled=false hides a section publicly, re-enable
 *      restores it
 *   9. Deleted content NEVER appears publicly (soft delete)
 *  10. Draft content NEVER appears publicly
 *  11. publishedAt stamping: published → set; draft → null; draft→published
 *      update stamps it
 *  12. Content CRUD per type + validation: missing title → 400, bad href → 400
 *
 * Usage: node scripts/verify-homepage-cms.js
 * Requires: dev server on http://localhost:3000, real DB.
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
const bcrypt = require("bcryptjs");

const BASE = "http://localhost:3000";
const DB_NAME = "marlooai";
// Slug regex allows [a-z0-9-] only — use a hyphenated prefix.
const PREFIX = "cms-" + Date.now() + "-";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const SUPPLIER_PHONE = "09157772007";
const SUPPLIER_PASS = "cms-supplier-123";

let passed = 0, failed = 0, total = 0;

async function testAsync(name, fn) {
  total++;
  process.stdout.write("\n  [TEST " + total + "] " + name + " ... ");
  try { await fn(); console.log("PASS"); passed++; }
  catch (err) { console.log("FAIL: " + err.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }

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
        cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
      }
    },
    header() { return Object.entries(cookies).map(([k, v]) => k + "=" + v).join("; "); },
  };
}

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

async function http(method, urlPath, jar, body) {
  const headers = {};
  if (jar) headers.Cookie = jar.header();
  let requestBody = body;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }
  const res = await fetch(BASE + urlPath, { method, headers, body: requestBody, redirect: "manual" });
  if (jar) jar.get(res.headers);
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: res.status, data };
}

// Minimal schemas for cleanup + direct inserts (fixtures only).
const SectionSchema = new mongoose.Schema(
  {
    slug: String, component: String, title: String, subtitle: String,
    enabled: Boolean, sortOrder: Number,
    presentation: { type: mongoose.Schema.Types.Mixed, default: {} },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "homepagesections" }
);
const HeroSlideSchema = new mongoose.Schema(
  {
    sectionSlug: String, title: String, subtitle: String, tagline: String,
    ctaLabel: String, ctaHref: String, imageDesktop: String, imageMobile: String,
    themeColor: String, sortOrder: Number, isActive: Boolean, status: String,
    publishedAt: { type: Date, default: null }, publishAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "homepageheroslides" }
);
const CampaignSchema = new mongoose.Schema(
  {
    sectionSlug: String, title: String, subtitle: String, tagline: String,
    ctaLabel: String, ctaHref: String, imageDesktop: String, imageMobile: String,
    themeColor: String, sortOrder: Number, isActive: Boolean, status: String,
    publishedAt: { type: Date, default: null }, publishAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "homepagecampaignbanners" }
);
const GiftSchema = new mongoose.Schema(
  {
    sectionSlug: String, title: String, description: String,
    ctaLabel: String, ctaHref: String, imageDesktop: String, imageMobile: String,
    themeColor: String, sortOrder: Number, isActive: Boolean, status: String,
    publishedAt: { type: Date, default: null }, publishAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "homepagegiftcollections" }
);
const TrustBadgeSchema = new mongoose.Schema(
  {
    sectionSlug: String, title: String, description: String, icon: String,
    sortOrder: Number, isActive: Boolean, status: String,
    publishedAt: { type: Date, default: null }, publishAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "homepagetrustbadges" }
);
const UserSchema = new mongoose.Schema(
  { name: String, phone: String, passwordHash: String, role: String, supplier: { type: mongoose.Schema.Types.ObjectId, default: null }, isActive: Boolean },
  { timestamps: true, collection: "users" }
);
const SupplierSchema = new mongoose.Schema(
  { user: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, businessName: String, contactPhone: String, isActive: Boolean },
  { timestamps: true, collection: "suppliers" }
);

const SECTIONS_ENDPOINT = "/api/admin/homepage/sections";
const CONTENT_ENDPOINTS = {
  "hero-slide": "/api/admin/homepage/hero-slides",
  "campaign-banner": "/api/admin/homepage/campaign-banners",
  "gift-collection": "/api/admin/homepage/gift-collections",
  "trust-badge": "/api/admin/homepage/trust-badges",
};

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 53 — HOMEPAGE CMS (REAL HTTP API)");
  console.log("==================================================================");

  try {
    const ping = await fetch(BASE + "/api/auth/csrf");
    assert(ping.status === 200, "dev server not reachable");
    console.log("\n  Dev server reachable\n");
  } catch {
    console.error("\nERROR: dev server not reachable. Start it with: npm run dev");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, { dbName: DB_NAME });
  const db = mongoose.connection.db;
  const Section = mongoose.models.HomepageSection_CMS || mongoose.model("HomepageSection_CMS", SectionSchema);
  const HeroSlide = mongoose.models.HeroSlide_CMS || mongoose.model("HeroSlide_CMS", HeroSlideSchema);
  const Campaign = mongoose.models.Campaign_CMS || mongoose.model("Campaign_CMS", CampaignSchema);
  const Gift = mongoose.models.Gift_CMS || mongoose.model("Gift_CMS", GiftSchema);
  const Trust = mongoose.models.Trust_CMS || mongoose.model("Trust_CMS", TrustBadgeSchema);

  // Idempotency sweep — remove leftovers from a previous interrupted run.
  await Section.deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("homepageheroslides").deleteMany({ sectionSlug: { $regex: "^" + PREFIX } });
  await db.collection("homepagecampaignbanners").deleteMany({ sectionSlug: { $regex: "^" + PREFIX } });
  await db.collection("homepagegiftcollections").deleteMany({ sectionSlug: { $regex: "^" + PREFIX } });
  await db.collection("homepagetrustbadges").deleteMany({ sectionSlug: { $regex: "^" + PREFIX } });

  const User = mongoose.models.User_CMS || mongoose.model("User_CMS", UserSchema);
  const Supplier = mongoose.models.Supplier_CMS || mongoose.model("Supplier_CMS", SupplierSchema);
  await User.deleteMany({ phone: SUPPLIER_PHONE });
  await Supplier.deleteMany({ businessName: "CMS Test Supplier" });

  let adminJar = null;
  let supplierJar = null;

  // --- TEST 1: seed admin login ---
  await testAsync("Seed admin login", async () => {
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    assert(adminJar.header().includes("session-token"), "no session cookie");
  });

  // --- TEST 2: authz (hermetic supplier fixture) ---
  await testAsync("Authz: unauth 401, supplier 403 on admin homepage endpoints", async () => {
    let res = await http("GET", SECTIONS_ENDPOINT, null);
    assert(res.status === 401, "unauth sections: expected 401, got " + res.status);
    res = await http("POST", CONTENT_ENDPOINTS["hero-slide"], null, {});
    assert(res.status === 401, "unauth content: expected 401, got " + res.status);
    // hermetic supplier fixture (the app's role check runs on the JWT role)
    const suppUser = await User.create({
      name: "CMS Supplier", phone: SUPPLIER_PHONE,
      passwordHash: await bcrypt.hash(SUPPLIER_PASS, 10), role: "supplier", isActive: true,
    });
    await Supplier.create({ user: suppUser._id, businessName: "CMS Test Supplier", contactPhone: SUPPLIER_PHONE, isActive: true });
    supplierJar = await login(SUPPLIER_PHONE, SUPPLIER_PASS);
    assert(supplierJar.header().includes("session-token"), "supplier login failed");
    res = await http("GET", SECTIONS_ENDPOINT, supplierJar);
    assert(res.status === 403, "supplier sections: expected 403, got " + res.status);
    res = await http("POST", CONTENT_ENDPOINTS["gift-collection"], supplierJar, { title: "x" });
    assert(res.status === 403, "supplier content: expected 403, got " + res.status);
  });

  // --- TEST 3: bootstrap ---
  let defaultSectionCount = 0;
  await testAsync("Sections bootstrap: GET seeds 9 default sections + static content", async () => {
    const res = await http("GET", SECTIONS_ENDPOINT, adminJar);
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    const sections = res.data.sections;
    defaultSectionCount = sections.length;
    assert(defaultSectionCount >= 9, "expected >= 9 default sections, got " + defaultSectionCount);
    const slugs = sections.map((s) => s.slug);
    assert(slugs.includes("hero") && slugs.includes("campaign-banner") &&
      slugs.includes("gift-collections") && slugs.includes("trust-badges"),
      "default slugs missing: " + slugs.join(","));
    // content seeded from static config
    const hero = await http("GET", CONTENT_ENDPOINTS["hero-slide"] + "?sectionSlug=hero", adminJar);
    assert(hero.status === 200 && hero.data.rows.length >= 3, "hero slides must be seeded (>=3)");
    const badges = await http("GET", CONTENT_ENDPOINTS["trust-badge"] + "?sectionSlug=trust-badges", adminJar);
    assert(badges.status === 200 && badges.data.rows.length >= 6, "trust badges must be seeded (>=6)");
  });

  // --- TEST 4: public composition + leak scan ---
  await testAsync("Public composition: sections ordered, public fields only (no leaks)", async () => {
    const res = await http("GET", "/api/homepage", null);
    assert(res.status === 200, "expected 200, got " + res.status);
    const sections = res.data.sections;
    assert(sections.length > 0, "empty composition");
    const hero = sections.find((s) => s.slug === "hero");
    assert(hero && hero.content.length >= 3, "hero section missing or empty");
    const leaked = ["status", "isActive", "publishedAt", "publishAt", "deletedAt"];
    for (const section of sections) {
      for (const row of section.content) {
        for (const key of leaked) {
          assert(!(key in row), "leaked field '" + key + "' in content row");
        }
      }
    }
    // order by sortOrder
    const orders = sections.map((s) => s.sortOrder ?? 0);
    const sorted = [...orders].sort((a, b) => a - b);
    assert(JSON.stringify(orders) === JSON.stringify(sorted), "sections not sorted by sortOrder");
  });

  // --- TEST 5: unknown component does not crash homepage ---
  const bogusSlug = PREFIX + "bogus";
  await testAsync("Unknown registry component: skipped by public API; GET / still 200", async () => {
    await Section.create({ slug: bogusSlug, component: "bogus-renderer", title: "", subtitle: "", enabled: true, sortOrder: 999 });
    const res = await http("GET", "/api/homepage", null);
    assert(res.status === 200, "public API must not crash, got " + res.status);
    assert(!res.data.sections.some((s) => s.slug === bogusSlug), "bogus section must be skipped");
    const page = await fetch(BASE + "/");
    assert(page.status === 200, "homepage HTML must render, got " + page.status);
    const html = await page.text();
    assert(html.includes("فروشگاه"), "homepage HTML looks empty");
    // admin create with bogus component must be rejected too
    const createRes = await http("POST", SECTIONS_ENDPOINT, adminJar, { slug: PREFIX + "bogus2", component: "nope" });
    assert(createRes.status === 400, "bogus component create must be 400, got " + createRes.status);
    await Section.deleteMany({ _id: { $in: (await Section.find({ slug: bogusSlug })).map((d) => d._id) } });
  });

  // --- TEST 6: multiple sections, same renderer, own content ---
  const slugA = PREFIX + "promo-a";
  const slugB = PREFIX + "promo-b";
  let contentAId = null;
  let contentBId = null;
  await testAsync("Multiple sections with same renderer keep their own content", async () => {
    let res = await http("POST", SECTIONS_ENDPOINT, adminJar, { slug: slugA, component: "campaign-banner" });
    assert(res.status === 201, "create A failed: " + res.status + " " + JSON.stringify(res.data));
    res = await http("POST", SECTIONS_ENDPOINT, adminJar, { slug: slugB, component: "campaign-banner" });
    assert(res.status === 201, "create B failed: " + res.status);

    res = await http("POST", CONTENT_ENDPOINTS["campaign-banner"], adminJar, {
      sectionSlug: slugA, title: "Banner A", subtitle: "subA", ctaLabel: "go", ctaHref: "/products", status: "published",
    });
    assert(res.status === 201, "content A failed: " + res.status + " " + JSON.stringify(res.data));
    contentAId = res.data.row._id;
    res = await http("POST", CONTENT_ENDPOINTS["campaign-banner"], adminJar, {
      sectionSlug: slugB, title: "Banner B", subtitle: "subB", ctaLabel: "go", ctaHref: "/coupons", status: "published",
    });
    assert(res.status === 201, "content B failed: " + res.status);
    contentBId = res.data.row._id;

    const pub = await http("GET", "/api/homepage", null);
    assert(pub.status === 200, "public API failed");
    const secA = pub.data.sections.find((s) => s.slug === slugA);
    const secB = pub.data.sections.find((s) => s.slug === slugB);
    assert(secA && secA.content.length === 1 && secA.content[0].title === "Banner A", "section A content wrong");
    assert(secB && secB.content.length === 1 && secB.content[0].title === "Banner B", "section B content wrong");
  });

  // --- TEST 7: slug/component immutability ---
  await testAsync("slug/component immutability: PUT changes rejected (400)", async () => {
    const slug = PREFIX + "immutable";
    const res = await http("POST", SECTIONS_ENDPOINT, adminJar, { slug, component: "trust-badges" });
    assert(res.status === 201, "setup create failed");
    const id = res.data.section._id;
    let put = await http("PUT", SECTIONS_ENDPOINT + "?id=" + id, adminJar, { slug: PREFIX + "renamed" });
    assert(put.status === 400, "slug change must be 400, got " + put.status + " " + JSON.stringify(put.data));
    put = await http("PUT", SECTIONS_ENDPOINT + "?id=" + id, adminJar, { component: "hero-carousel" });
    assert(put.status === 400, "component change must be 400, got " + put.status);
    // mutable fields still work
    put = await http("PUT", SECTIONS_ENDPOINT + "?id=" + id, adminJar, { title: "Changed", enabled: false, sortOrder: 5 });
    assert(put.status === 200, "mutable update failed: " + put.status + " " + JSON.stringify(put.data));
    assert(put.data.section.title === "Changed" && put.data.section.enabled === false, "update not applied");
    // public API must NOT show the disabled section
    const pub = await http("GET", "/api/homepage", null);
    assert(!pub.data.sections.some((s) => s.slug === slug), "disabled section leaked publicly");
    // re-enable
    await http("PUT", SECTIONS_ENDPOINT + "?id=" + id, adminJar, { enabled: true });
  });

  // --- TEST 8: content CRUD + validation on hero-slides ---
  let heroId = null;
  await testAsync("Hero content CRUD: create (published), update, validation errors", async () => {
    // missing title → 400
    let res = await http("POST", CONTENT_ENDPOINTS["hero-slide"], adminJar, { sectionSlug: slugA, title: "" });
    assert(res.status === 400, "missing title must be 400, got " + res.status);
    // bad href → 400
    res = await http("POST", CONTENT_ENDPOINTS["hero-slide"], adminJar, { sectionSlug: slugA, title: "X", ctaHref: "javascript:alert(1)" });
    assert(res.status === 400, "javascript: href must be 400, got " + res.status);
    // valid create → 201
    res = await http("POST", CONTENT_ENDPOINTS["hero-slide"], adminJar, {
      sectionSlug: slugA, title: "Slide 1", subtitle: "s", tagline: "t",
      ctaLabel: "خرید", ctaHref: "/products", imageDesktop: "", imageMobile: "",
      themeColor: "from-zinc-900 via-zinc-800 to-zinc-700", sortOrder: 1, isActive: true, status: "published",
    });
    assert(res.status === 201, "create failed: " + res.status + " " + JSON.stringify(res.data));
    heroId = res.data.row._id;
    assert(res.data.row.publishedAt, "publishedAt must be set on create");
    // update
    res = await http("PUT", CONTENT_ENDPOINTS["hero-slide"] + "?id=" + heroId, adminJar, { title: "Slide 1 updated", isActive: false });
    assert(res.status === 200, "update failed: " + res.status + " " + JSON.stringify(res.data));
    assert(res.data.row.title === "Slide 1 updated" && res.data.row.isActive === false, "update not applied");
    await http("PUT", CONTENT_ENDPOINTS["hero-slide"] + "?id=" + heroId, adminJar, { isActive: true });
  });

  // --- TEST 9: deleted content never public ---
  await testAsync("Soft-deleted content never appears publicly", async () => {
    // heroId belongs to slugA (a campaign section); create its own hero slide in a hero-compatible test section
    const slug = PREFIX + "delete-test";
    await http("POST", SECTIONS_ENDPOINT, adminJar, { slug, component: "hero-carousel" });
    const res = await http("POST", CONTENT_ENDPOINTS["hero-slide"], adminJar, { sectionSlug: slug, title: "To Delete", status: "published" });
    assert(res.status === 201, "setup create failed");
    const id = res.data.row._id;
    let pub = await http("GET", "/api/homepage", null);
    let sec = pub.data.sections.find((s) => s.slug === slug);
    assert(sec && sec.content.some((r) => r._id === id), "published row must be public");
    // soft delete
    const del = await http("DELETE", CONTENT_ENDPOINTS["hero-slide"] + "?id=" + id, adminJar);
    assert(del.status === 200, "delete failed: " + del.status);
    pub = await http("GET", "/api/homepage", null);
    sec = pub.data.sections.find((s) => s.slug === slug);
    assert(!sec || !sec.content.some((r) => r._id === id), "deleted row must NOT be public");
  });

  // --- TEST 10: draft never public ---
  await testAsync("Draft content never appears publicly", async () => {
    const slug = PREFIX + "draft-test";
    await http("POST", SECTIONS_ENDPOINT, adminJar, { slug, component: "hero-carousel" });
    const res = await http("POST", CONTENT_ENDPOINTS["hero-slide"], adminJar, { sectionSlug: slug, title: "Draft Slide", status: "draft" });
    assert(res.status === 201, "draft create failed: " + res.status);
    const id = res.data.row._id;
    const pub = await http("GET", "/api/homepage", null);
    const sec = pub.data.sections.find((s) => s.slug === slug);
    assert(!sec || !sec.content.some((r) => r._id === id), "draft row must NOT be public");
  });

  // --- TEST 11: publishedAt stamping ---
  await testAsync("publishedAt stamping: draft → null, publish update stamps it", async () => {
    const slug = PREFIX + "stamp-test";
    await http("POST", SECTIONS_ENDPOINT, adminJar, { slug, component: "trust-badges" });
    let res = await http("POST", CONTENT_ENDPOINTS["trust-badge"], adminJar, { sectionSlug: slug, title: "Stamped", icon: "truck", status: "draft" });
    assert(res.status === 201, "draft create failed");
    assert(res.data.row.publishedAt === null, "draft publishedAt must be null");
    const id = res.data.row._id;
    res = await http("PUT", CONTENT_ENDPOINTS["trust-badge"] + "?id=" + id, adminJar, { status: "published" });
    assert(res.status === 200, "publish update failed");
    assert(!!res.data.row.publishedAt, "publishedAt must be stamped on publish");
    // public now
    let pub = await http("GET", "/api/homepage", null);
    let sec = pub.data.sections.find((s) => s.slug === slug);
    assert(sec && sec.content.length === 1, "published badge must be public");
    // back to draft → gone + publishedAt null
    res = await http("PUT", CONTENT_ENDPOINTS["trust-badge"] + "?id=" + id, adminJar, { status: "draft" });
    assert(res.data.row.publishedAt === null, "draft must clear publishedAt");
    pub = await http("GET", "/api/homepage", null);
    sec = pub.data.sections.find((s) => s.slug === slug);
    assert(!sec || sec.content.length === 0, "draft badge must be hidden");
  });

  // --- TEST 12: gift + campaign content validation ---
  await testAsync("Gift/campaign content validation (missing title → 400)", async () => {
    let res = await http("POST", CONTENT_ENDPOINTS["gift-collection"], adminJar, { sectionSlug: slugA, title: "" });
    assert(res.status === 400, "gift missing title must be 400");
    res = await http("POST", CONTENT_ENDPOINTS["campaign-banner"], adminJar, { sectionSlug: slugA, title: "OK Banner", status: "published" });
    assert(res.status === 201, "campaign create failed");
    res = await http("POST", CONTENT_ENDPOINTS["trust-badge"], adminJar, { sectionSlug: slugA, title: "Badge", icon: "not-an-icon", status: "published" });
    assert(res.status === 400, "non-whitelisted icon must be 400");
  });

  // --- TEST 13: malformed ObjectId → 400 (never a CastError 500) ---
  await testAsync("Malformed ObjectId → 400 on content + section PUT (no 500 CastError)", async () => {
    const bad = "not-an-objectid";
    // content PUT/DELETE
    let res = await http("PUT", CONTENT_ENDPOINTS["hero-slide"] + "?id=" + bad, adminJar, { title: "x" });
    assert(res.status === 400, "content PUT malformed id must be 400, got " + res.status);
    res = await http("DELETE", CONTENT_ENDPOINTS["hero-slide"] + "?id=" + bad, adminJar, null);
    assert(res.status === 400, "content DELETE malformed id must be 400, got " + res.status);
    // section PUT/DELETE
    res = await http("PUT", SECTIONS_ENDPOINT + "?id=" + bad, adminJar, { title: "x" });
    assert(res.status === 400, "section PUT malformed id must be 400, got " + res.status);
    res = await http("DELETE", SECTIONS_ENDPOINT + "?id=" + bad, adminJar, null);
    assert(res.status === 400, "section DELETE malformed id must be 400, got " + res.status);
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await Section.deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("homepageheroslides").deleteMany({ sectionSlug: { $regex: "^" + PREFIX } });
  await db.collection("homepagecampaignbanners").deleteMany({ sectionSlug: { $regex: "^" + PREFIX } });
  await db.collection("homepagegiftcollections").deleteMany({ sectionSlug: { $regex: "^" + PREFIX } });
  await db.collection("homepagetrustbadges").deleteMany({ sectionSlug: { $regex: "^" + PREFIX } });
  await User.deleteMany({ _id: { $in: (await User.find({ phone: SUPPLIER_PHONE })).map((u) => u._id) } });
  await Supplier.deleteMany({ businessName: "CMS Test Supplier" });
  await db.collection("ratelimits").deleteMany({});
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
