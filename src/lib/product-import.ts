/**
 * Product CSV import executor (Session 51) — server-only.
 *
 * Shared by the admin + supplier import routes. Parses/validates the CSV,
 * resolves category/brand/tag/supplier refs by name (single queries, no N+1),
 * pre-scans existing slugs, then creates rows SEQUENTIALLY through the same
 * hardened write rules as the existing product APIs (sanitize + Mongoose
 * validators). Each row is all-or-nothing; failures/skips are reported
 * per-row with Persian reasons. Create-only (v1): duplicate slug → skipped,
 * never overwritten.
 */
import {
  parseProductCsv,
  MAX_IMPORT_ROWS,
  MAX_CSV_BYTES,
} from "@/lib/product-csv";
import { sanitizePlainText } from "@/lib/sanitize";
import Product from "@/models/Product";
import Category from "@/models/Category";
import Brand from "@/models/Brand";
import Tag from "@/models/Tag";
import Supplier from "@/models/Supplier";
import type { ProductImportReport, ProductImportRowResult } from "@/types";

export interface ImportExecutionResult {
  error?: string;
  status?: number;
  report?: ProductImportReport;
}

function isE11000(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: number }).code === 11000
  );
}

function lower(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Execute a product CSV import.
 * @param supplierId — when provided (supplier role), the supplier column is
 *   ignored and rows are auto-assigned to this supplier.
 */
export async function executeProductImport(
  csv: string,
  supplierId?: string
): Promise<ImportExecutionResult> {
  if (!csv || !csv.trim()) {
    return { error: "متن CSV الزامی است", status: 400 };
  }
  // Byte-length (not char-length) so Persian UTF-8 content can't smuggle a
  // larger payload past the guard under its name.
  if (Buffer.byteLength(csv, "utf8") > MAX_CSV_BYTES) {
    return {
      error: "حجم فایل CSV بیشتر از حد مجاز است (حداکثر ۵۰۰ کیلوبایت)",
      status: 413,
    };
  }

  const parsed = parseProductCsv(csv);
  if (!parsed.ok) {
    return { error: parsed.error, status: 400 };
  }
  if (parsed.totalRows > MAX_IMPORT_ROWS) {
    return {
      error: `حداکثر ${MAX_IMPORT_ROWS} ردیف در هر فایل مجاز است`,
      status: 400,
    };
  }

  // Resolve reference maps once (case-insensitive by lowercased name).
  const [categories, brands, tags, suppliers] = await Promise.all([
    Category.find({ isActive: true }).select("_id name").lean(),
    Brand.find({ isActive: true }).select("_id name").lean(),
    Tag.find({ isActive: true }).select("_id name").lean(),
    supplierId
      ? Promise.resolve([])
      : Supplier.find({ isActive: true }).select("_id businessName").lean(),
  ]);

  const categoryId = new Map(
    categories.map((c) => [lower(String(c.name)), String(c._id)])
  );
  const brandId = new Map(
    brands.map((b) => [lower(String(b.name)), String(b._id)])
  );
  const tagId = new Map(
    tags.map((t) => [lower(String(t.name)), String(t._id)])
  );
  const supplierIdByName = new Map(
    suppliers.map((s) => [lower(String(s.businessName)), String(s._id)])
  );

  // Pre-scan existing slugs (single query — no per-row exists()).
  const slugs = [...new Set(parsed.rows.map((r) => r.slug).filter(Boolean))];
  const existingSlugs = new Set(
    await Product.find({ slug: { $in: slugs } }).distinct("slug")
  );

  const results: ProductImportRowResult[] = [];
  let created = 0;
  let skipped = 0;
  let failed = 0;
  const seenInFile = new Set<string>();

  for (const row of parsed.rows) {
    const r: ProductImportRowResult = {
      rowNumber: row.rowNumber,
      name: row.name,
      status: "failed",
      reason: "",
    };

    if (row.errors.length > 0) {
      r.reason = row.errors.join("؛ ");
    } else if (seenInFile.has(row.slug)) {
      r.status = "skipped";
      r.reason = "این اسلاگ در فایل تکراری است";
    } else if (existingSlugs.has(row.slug)) {
      r.status = "skipped";
      r.reason = "محصولی با این اسلاگ قبلاً وجود دارد";
    } else {
      // NOTE: `seenInFile` is only marked on a successful create (below), so a
      // row that FAILS ref resolution does NOT reserve its slug — a later
      // valid row with the same slug is still allowed to create.
      const catId = categoryId.get(lower(row.category));
      if (!catId) {
        r.reason = `دسته‌بندی «${row.category}» یافت نشد`;
      } else {
        let brandIdVal: string | null = null;
        if (row.brand) {
          const b = brandId.get(lower(row.brand));
          if (!b) {
            r.reason = `برند «${row.brand}» یافت نشد`;
          } else {
            brandIdVal = b;
          }
        }

        if (!r.reason) {
          const tagIds: string[] = [];
          for (const t of row.tags) {
            const tg = tagId.get(lower(t));
            if (!tg) {
              r.reason = `برچسب «${t}» یافت نشد`;
              break;
            }
            tagIds.push(tg);
          }

          if (!r.reason) {
            let supId = supplierId;
            if (!supId) {
              const found = supplierIdByName.get(lower(row.supplier));
              if (!found) {
                r.reason =
                  "ستون supplier الزامی است — نام کسب‌وکار فروشنده را وارد کنید";
              } else {
                supId = found;
              }
            }

            if (supId) {
              try {
                // Hardened path: same sanitize + Mongoose-validator rules as
                // the existing product APIs. Simple products skip the variant
                // pre-processing (prepareVariantsForSave is a no-op for them).
                await Product.create({
                  name: sanitizePlainText(row.name),
                  slug: row.slug,
                  description: sanitizePlainText(row.description),
                  images: row.images,
                  brand: brandIdVal,
                  tags: tagIds,
                  category: catId,
                  supplier: supId,
                  supplierPrice: row.supplierPrice,
                  price: row.price,
                  stock: row.stock,
                  hasVariants: false,
                  variants: [],
                  isActive: row.isActive,
                });
                r.status = "created";
                seenInFile.add(row.slug);
              } catch (err) {
                if (isE11000(err)) {
                  r.status = "skipped";
                  r.reason = "محصولی با این اسلاگ قبلاً وجود دارد";
                } else {
                  r.reason = "خطای غیرمنتظره در ذخیره‌سازی";
                }
              }
            }
          }
        }
      }
    }

    if (r.status === "failed" && !r.reason) {
      r.reason = "خطای ناشناخته";
    }
    if (r.status === "created") created++;
    else if (r.status === "skipped") skipped++;
    else failed++;
    results.push(r);
  }

  return {
    report: {
      total: parsed.totalRows,
      created,
      skipped,
      failed,
      results,
    },
  };
}
