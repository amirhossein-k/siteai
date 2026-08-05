import { describe, expect, it } from "vitest";
import {
  escapeFormula,
  parseProductCsv,
  serializeProductsCsv,
  toLatinDigits,
} from "@/lib/product-csv";
import { PRODUCT_CSV_HEADERS } from "@/lib/product-csv-constants";

const HEADER_LINE =
  "name,slug,description,price,supplierPrice,stock,category,brand,tags,images,isActive,supplier";

function csv(rows: string[]): string {
  return [HEADER_LINE, ...rows].join("\n");
}

describe("toLatinDigits", () => {
  it("converts Persian digits", () => {
    expect(toLatinDigits("۱۰۰۰۰۰")).toBe("100000");
  });

  it("converts Arabic-Indic digits", () => {
    expect(toLatinDigits("٠١٢٣")).toBe("0123");
  });

  it("leaves ASCII and non-digit characters alone", () => {
    expect(toLatinDigits("abc123")).toBe("abc123");
    expect(toLatinDigits("قیمت ۵۰")).toBe("قیمت 50");
    expect(toLatinDigits("۱۰۰٬۰۰۰")).toBe("100٬000"); // ٬ is not a digit
  });
});

describe("parseProductCsv", () => {
  it("returns a Persian parse error for malformed CSV", () => {
    const result = parseProductCsv('name,slug\n"unterminated');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("فرمت CSV نامعتبر");
  });

  it("rejects an empty file", () => {
    const result = parseProductCsv("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("خالی");
  });

  it("parses a valid row with all fields", () => {
    const result = parseProductCsv(
      csv(["کتاب تست,test-book,توضیح کوتاه,۵۰۰۰۰,40000,3,کتاب,نشر آزمون,جدید،ویژه,img1.jpg,1,تامین"])
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalRows).toBe(1);
    const row = result.rows[0];
    expect(row.rowNumber).toBe(1);
    expect(row.name).toBe("کتاب تست");
    expect(row.slug).toBe("test-book");
    expect(row.price).toBe(50000); // Persian digits normalized
    expect(row.supplierPrice).toBe(40000);
    expect(row.stock).toBe(3);
    expect(row.tags).toEqual(["جدید", "ویژه"]);
    expect(row.images).toEqual(["img1.jpg"]);
    expect(row.isActive).toBe(true);
    expect(row.supplier).toBe("تامین");
    expect(row.errors).toEqual([]);
  });

  it("collects per-row validation errors instead of dropping the row", () => {
    const result = parseProductCsv(
      csv([" ,  ,,abc,,1.5,,برند,,,بله,"])
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const errors = result.rows[0].errors;
    expect(errors).toContain("نام محصول الزامی است");
    expect(errors).toContain("اسلاگ الزامی است");
    expect(errors).toContain("قیمت باید عددی بزرگتر از صفر باشد");
    expect(errors).toContain("قیمت تأمین باید عددی بزرگتر از صفر باشد");
    expect(errors).toContain("موجودی باید عدد صحیح غیرمنفی باشد");
    expect(errors).toContain("نام دسته‌بندی الزامی است");
  });

  it("rejects an invalid slug format", () => {
    const result = parseProductCsv(csv(["محصول,Bad Slug!,x,100,80,1,دسته,,,img,1,"]));
    if (!result.ok) return;
    expect(result.rows[0].errors).toContain(
      "اسلاگ فقط شامل حروف لاتین کوچک، اعداد و خط تیره است"
    );
  });

  it("rejects an unrecognized isActive value", () => {
    const result = parseProductCsv(csv(["محصول,ok-slug,x,100,80,1,دسته,,,img,yes,"]));
    if (!result.ok) return;
    expect(result.rows[0].errors).toContain("مقدار isActive باید 1 یا 0 باشد");
  });

  it("parses all isActive truthy/falsy representations", () => {
    const result = parseProductCsv(
      csv([
        "a,a-slug,,100,80,1,دسته,,,img,1,",
        "b,b-slug,,100,80,1,دسته,,,img,0,",
        "c,c-slug,,100,80,1,دسته,,,img,بله,",
        "d,d-slug,,100,80,1,دسته,,,img,خیر,",
        "e,e-slug,,100,80,1,دسته,,,img,,", // empty → default true
      ])
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => r.isActive)).toEqual([true, false, true, false, true]);
  });

  it("rejects an over-long description", () => {
    const long = "x".repeat(2001);
    const result = parseProductCsv(
      csv([`محصول,ok-slug,${long},100,80,1,دسته,,,img,1,`])
    );
    if (!result.ok) return;
    expect(result.rows[0].errors).toContain("توضیحات حداکثر ۲۰۰۰ کاراکتر");
  });

  it("rejects an over-long product name", () => {
    const result = parseProductCsv(
      csv([`${"ی".repeat(201)},ok-slug,,100,80,1,دسته,,,img,1,`])
    );
    if (!result.ok) return;
    expect(result.rows[0].errors).toContain("نام محصول حداکثر ۲۰۰ کاراکتر");
  });
});

describe("escapeFormula", () => {
  it("neutralizes spreadsheet formula prefixes", () => {
    expect(escapeFormula("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeFormula("+1")).toBe("'+1");
    expect(escapeFormula("-1")).toBe("'-1");
    expect(escapeFormula("@cmd")).toBe("'@cmd");
    expect(escapeFormula("\t")).toBe("'\t");
  });

  it("leaves safe values unchanged", () => {
    expect(escapeFormula("normal text")).toBe("normal text");
    expect(escapeFormula("10% off")).toBe("10% off");
  });
});

describe("serializeProductsCsv", () => {
  const product = {
    name: "=EVIL",
    slug: "evil",
    description: "desc",
    price: 100,
    supplierPrice: 80,
    stock: 5,
    category: "دسته",
    brand: "برند",
    tags: ["a", "b"],
    images: ["img.jpg"],
    isActive: true,
    supplier: "sup",
  };

  it("prepends a UTF-8 BOM and the header row", () => {
    const out = serializeProductsCsv([product]);
    expect(out.startsWith("\uFEFF")).toBe(true);
    expect(out).toContain(HEADER_LINE);
    for (const h of PRODUCT_CSV_HEADERS) expect(out).toContain(h);
  });

  it("escapes formula-injection prefixes and serializes booleans", () => {
    const out = serializeProductsCsv([product]);
    expect(out).toContain("'=EVIL");
    expect(out).toContain("isActive,supplier"); // header
    expect(out).toContain(",1,sup"); // active row tail

    const inactive = serializeProductsCsv([{ ...product, isActive: false }]);
    expect(inactive).toContain(",0,sup");
  });

  it("joins tags and images with comma-space", () => {
    const out = serializeProductsCsv([product]);
    expect(out).toContain("a, b");
    expect(out).toContain("img.jpg");
  });
});
