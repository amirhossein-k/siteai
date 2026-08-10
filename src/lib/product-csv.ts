/**
 * Product CSV parse/serialize (Session 51).
 *
 * Server-authoritative: parses an uploaded CSV into validated rows, and
 * serializes products back to CSV for export (with CSV formula-injection
 * escaping + a UTF-8 BOM so Excel renders Persian correctly).
 *
 * Simple products only (v1) — variant products stay in the existing form.
 */
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import {
  PRODUCT_CSV_HEADERS,
  MAX_IMPORT_ROWS,
  MAX_CSV_BYTES,
} from "@/lib/product-csv-constants";
import { SLUG_PATTERN } from "@/lib/product-slug";
import { toLatinDigits } from "@/lib/utils";

// Session 70 — toLatinDigits moved to src/lib/utils.ts (shared with slugify);
// re-exported here so existing importers keep working.
export { toLatinDigits };

/** One validated row from the CSV (rowNumber is 1-based, header excluded). */
export interface CsvProductRow {
  rowNumber: number;
  name: string;
  slug: string;
  description: string;
  price: number;
  supplierPrice: number;
  stock: number;
  category: string;
  brand: string;
  tags: string[];
  images: string[];
  isActive: boolean;
  /** Admin-only column (supplier businessName); suppliers auto-set their own. */
  supplier: string;
  /** Persian validation messages — any error fails the row. */
  errors: string[];
}

export interface ProductCsvParseResult {
  ok: boolean;
  /** Global parse error (malformed CSV) — Persian. */
  error?: string;
  totalRows: number;
  rows: CsvProductRow[];
}

function parseBool(value: string): boolean | null {
  const v = value.trim().toLowerCase();
  if (v === "") return true; // empty → default true (matches the form default)
  if (v === "1" || v === "true" || v === "بله") return true;
  if (v === "0" || v === "false" || v === "خیر") return false;
  return null;
}

/**
 * Parse a CSV string into validated rows.
 * A row that fails structural validation keeps its `errors` so the route can
 * report it per-row (never silently dropped, never partially created).
 */
export function parseProductCsv(csvText: string): ProductCsvParseResult {
  let records: unknown;
  try {
    records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_column_count: true,
      trim: true,
    });
  } catch {
    return {
      ok: false,
      error: "فرمت CSV نامعتبر است — ساختار فایل را بررسی کنید",
      totalRows: 0,
      rows: [],
    };
  }

  if (!Array.isArray(records) || records.length === 0) {
    return {
      ok: false,
      error: "فایل CSV خالی است یا ردیفی ندارد",
      totalRows: 0,
      rows: [],
    };
  }

  const rows: CsvProductRow[] = [];
  let n = 0;
  for (const rec of records as Array<Record<string, unknown>>) {
    n++;
    const get = (key: string) => String(rec[key] ?? "").trim();
    const errors: string[] = [];

    const name = get("name");
    const slug = get("slug").toLowerCase();
    const description = get("description");
    const priceRaw = toLatinDigits(get("price"));
    const supplierPriceRaw = toLatinDigits(get("supplierPrice"));
    const stockRaw = toLatinDigits(get("stock"));
    const category = get("category");
    const brand = get("brand");
    const tags = get("tags")
      .split(/[,،]/)
      .map((t) => t.trim())
      .filter(Boolean);
    const images = get("images")
      .split(/[,،]/)
      .map((t) => t.trim())
      .filter(Boolean);
    const supplier = get("supplier");

    if (!name) errors.push("نام محصول الزامی است");
    else if (name.length > 200) errors.push("نام محصول حداکثر ۲۰۰ کاراکتر");

    if (!slug) errors.push("اسلاگ الزامی است");
    else if (!SLUG_PATTERN.test(slug))
      errors.push("اسلاگ فقط شامل حروف فارسی، حروف لاتین کوچک، اعداد و خط تیره است");

    if (description.length > 2000) errors.push("توضیحات حداکثر ۲۰۰۰ کاراکتر");

    const price = Number(priceRaw);
    if (priceRaw === "" || !Number.isFinite(price) || price <= 0)
      errors.push("قیمت باید عددی بزرگتر از صفر باشد");

    const supplierPrice = Number(supplierPriceRaw);
    if (supplierPriceRaw === "" || !Number.isFinite(supplierPrice) || supplierPrice <= 0)
      errors.push("قیمت تأمین باید عددی بزرگتر از صفر باشد");

    const stock = Number(stockRaw);
    if (stockRaw === "" || !Number.isInteger(stock) || stock < 0)
      errors.push("موجودی باید عدد صحیح غیرمنفی باشد");

    if (!category) errors.push("نام دسته‌بندی الزامی است");

    const isActiveVal = parseBool(get("isActive"));
    if (isActiveVal === null) errors.push("مقدار isActive باید 1 یا 0 باشد");

    rows.push({
      rowNumber: n,
      name,
      slug,
      description,
      price,
      supplierPrice,
      stock,
      category,
      brand,
      tags,
      images,
      isActive: isActiveVal ?? true,
      supplier,
      errors,
    });
  }

  return { ok: true, totalRows: rows.length, rows };
}

/** A product ready for CSV export (names already resolved). */
export interface CsvExportProduct {
  name: string;
  slug: string;
  description: string;
  price: number;
  supplierPrice: number;
  stock: number;
  category: string;
  brand: string;
  tags: string[];
  images: string[];
  isActive: boolean;
  supplier: string;
}

/** CSV formula-injection guard: neutralizes values starting with = + - @ \t \r. */
export function escapeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
}

/**
 * Serialize products to CSV (export). Prepends a UTF-8 BOM so Excel opens
 * Persian text correctly; escapes formula-injection prefixes.
 */
export function serializeProductsCsv(products: CsvExportProduct[]): string {
  const records = products.map((p) => ({
    name: escapeFormula(p.name),
    slug: escapeFormula(p.slug),
    description: escapeFormula(p.description),
    price: p.price,
    supplierPrice: p.supplierPrice,
    stock: p.stock,
    category: escapeFormula(p.category),
    brand: escapeFormula(p.brand),
    tags: escapeFormula(p.tags.join(", ")),
    images: escapeFormula(p.images.join(", ")),
    isActive: p.isActive ? "1" : "0",
    supplier: escapeFormula(p.supplier),
  }));
  const body = stringify(records, {
    header: true,
    columns: [...PRODUCT_CSV_HEADERS] as string[],
  });
  return "\uFEFF" + body;
}

export { PRODUCT_CSV_HEADERS, MAX_IMPORT_ROWS, MAX_CSV_BYTES };
