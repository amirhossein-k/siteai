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

/**
 * Session 62 — OTP code request schema (SMS login/register step 1).
 */
export const otpRequestSchema = z.object({
  phone: z
    .string()
    .min(1, "شماره موبایل الزامی است")
    .regex(/^09\d{9}$/, "شماره موبایل معتبر نیست"),
  purpose: z.enum(["login", "register"], {
    message: "نوع درخواست نامعتبر است",
  }),
});

export type OtpRequestData = z.infer<typeof otpRequestSchema>;

/**
 * Session 62 — OTP code verify schema (SMS login/register step 2).
 * `name` is required ONLY for the register purpose (account creation).
 */
export const otpVerifySchema = z.object({
  phone: z
    .string()
    .min(1, "شماره موبایل الزامی است")
    .regex(/^09\d{9}$/, "شماره موبایل معتبر نیست"),
  code: z
    .string()
    .min(1, "کد تأیید الزامی است")
    .regex(/^\d{6}$/, "کد تأیید باید ۶ رقم باشد"),
  purpose: z.enum(["login", "register"], {
    message: "نوع درخواست نامعتبر است",
  }),
  name: z
    .string()
    .min(2, "نام باید حداقل ۲ کاراکتر باشد")
    .max(50, "نام حداکثر ۵۰ کاراکتر")
    .optional(),
});

export type OtpVerifyData = z.infer<typeof otpVerifySchema>;
