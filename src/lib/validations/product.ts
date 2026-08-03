import { z } from "zod";

/**
 * Product variant validation schema (client-side form validation)
 * Server-side validation in src/lib/product-variants.ts is authoritative.
 */
export const productVariantSchema = z.object({
  sku: z
    .string()
    .min(1, "SKU الزامی است")
    .max(64, "SKU حداکثر ۶۴ کاراکتر"),
  attributes: z
    .array(
      z.object({
        attributeId: z.string().min(1, "ویژگی الزامی است"),
        name: z.string().min(1),
        value: z.string().min(1, "مقدار ویژگی الزامی است"),
      })
    )
    .min(1, "حداقل یک ویژگی لازم است"),
  price: z.coerce
    .number()
    .min(0, "قیمت نمی‌تواند منفی باشد")
    .positive("قیمت باید بیشتر از صفر باشد"),
  supplierPrice: z.coerce
    .number()
    .min(0, "قیمت تأمین نمی‌تواند منفی باشد")
    .positive("قیمت تأمین باید بیشتر از صفر باشد"),
  stock: z.coerce
    .number()
    .int("موجودی باید عدد صحیح باشد")
    .min(0, "موجودی نمی‌تواند منفی باشد"),
  images: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
});

export const MAX_VARIANTS = 200;

/**
 * Product form base schema (before superRefine, so .omit() works on it)
 */
const productBaseSchema = z.object({
  name: z
    .string()
    .min(1, "نام محصول الزامی است")
    .max(200, "نام محصول حداکثر ۲۰۰ کاراکتر"),
  slug: z
    .string()
    .min(1, "اسلاگ الزامی است")
    .max(200, "اسلاگ حداکثر ۲۰۰ کاراکتر")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "اسلاگ فقط شامل حروف لاتین، اعداد و خط تیره"),
  description: z
    .string()
    .max(2000, "توضیحات حداکثر ۲۰۰۰ کاراکتر")
    .optional()
    .or(z.literal("")),
  brand: z.string().optional().or(z.literal("")),
  category: z.string().min(1, "دسته‌بندی الزامی است"),
  supplier: z.string().min(1, "فروشنده الزامی است"),
  price: z.coerce
    .number()
    .min(0, "قیمت نمی‌تواند منفی باشد")
    .positive("قیمت باید بیشتر از صفر باشد"),
  supplierPrice: z.coerce
    .number()
    .min(0, "قیمت تأمین نمی‌تواند منفی باشد")
    .positive("قیمت تأمین باید بیشتر از صفر باشد"),
  stock: z.coerce
    .number()
    .int("موجودی باید عدد صحیح باشد")
    .min(0, "موجودی نمی‌تواند منفی باشد"),
  isActive: z.boolean(),
});

/**
 * Shared refine: rejects variant counts above the sane maximum.
 * (The full variant-list validation lives server-side in product-variants.ts.)
 */
function refineVariants(data: unknown, ctx: z.RefinementCtx) {
  const variants = (data as { variants?: unknown[] }).variants || [];
  if (variants.length > 0 && variants.length > MAX_VARIANTS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["variants"],
      message: `حداکثر ${MAX_VARIANTS} تنوع مجاز است`,
    });
  }
}

/**
 * Product form validation schema
 */
export const productSchema = productBaseSchema.superRefine(refineVariants);

export type ProductFormData = z.infer<typeof productSchema> & {
  images?: string[];
  tags?: string[];
  hasVariants?: boolean;
  variants?: z.infer<typeof productVariantSchema>[];
};

/**
 * Supplier product form validation schema (no supplier field — auto-set server-side)
 */
export const supplierProductSchema = productBaseSchema
  .omit({ supplier: true })
  .superRefine(refineVariants);

export type SupplierProductFormData = z.infer<typeof supplierProductSchema> & {
  images?: string[];
  tags?: string[];
  hasVariants?: boolean;
  variants?: z.infer<typeof productVariantSchema>[];
};
