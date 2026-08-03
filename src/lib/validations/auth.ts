import { z } from "zod";

/**
 * Login form validation schema
 */
export const loginSchema = z.object({
  phone: z
    .string()
    .min(1, "شماره موبایل الزامی است")
    .regex(/^09\d{9}$/, "شماره موبایل معتبر نیست"),
  password: z
    .string()
    .min(1, "رمز عبور الزامی است")
    .min(6, "رمز عبور باید حداقل ۶ کاراکتر باشد"),
});

export type LoginFormData = z.infer<typeof loginSchema>;

/**
 * Register form validation schema
 */
export const registerSchema = z
  .object({
    name: z
      .string()
      .min(2, "نام باید حداقل ۲ کاراکتر باشد")
      .max(50, "نام حداکثر ۵۰ کاراکتر"),
    phone: z
      .string()
      .min(1, "شماره موبایل الزامی است")
      .regex(/^09\d{9}$/, "شماره موبایل معتبر نیست"),
    password: z
      .string()
      .min(6, "رمز عبور باید حداقل ۶ کاراکتر باشد")
      .max(100, "رمز عبور حداکثر ۱۰۰ کاراکتر"),
    confirmPassword: z.string().min(1, "تکرار رمز عبور الزامی است"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "رمز عبور و تکرار آن یکسان نیستند",
    path: ["confirmPassword"],
  });

export type RegisterFormData = z.infer<typeof registerSchema>;
