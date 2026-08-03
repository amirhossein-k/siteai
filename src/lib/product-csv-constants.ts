/**
 * CSV product import/export — shared constants.
 *
 * Kept dependency-free (no csv-parse import) so client components can import
 * the column headers + limits safely without bundling the CSV parser.
 */

/** Column order of the product CSV (also the export header row). */
export const PRODUCT_CSV_HEADERS = [
  "name",
  "slug",
  "description",
  "price",
  "supplierPrice",
  "stock",
  "category",
  "brand",
  "tags",
  "images",
  "isActive",
  "supplier",
] as const;

/** Maximum import rows per file. */
export const MAX_IMPORT_ROWS = 1000;

/** Maximum raw CSV body size (chars) — abuse guard. */
export const MAX_CSV_BYTES = 500_000;
