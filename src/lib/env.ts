/**
 * Environment variable validation
 * Ensures required env vars are present at build/runtime
 */

const requiredEnvVars = [
  "MONGODB_URI",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
] as const;

const optionalEnvVars = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_GA_ID",
  "TELEGRAM_BOT_TOKEN",
  "ADMIN_TELEGRAM_CHAT_ID",
  "ZARINPAL_MERCHANT_ID",
  "ZARINPAL_CALLBACK_URL",
  "LIARA_ENDPOINT",
  "LIARA_BUCKET_NAME",
  "LIARA_ACCESS_KEY",
  "LIARA_SECRET_KEY",
  "LIARA_REGION",
  "SMS_IR_API_KEY",
  "SMS_IR_TEMPLATE_ID",
] as const;

type RequiredEnvVar = (typeof requiredEnvVars)[number];
type OptionalEnvVar = (typeof optionalEnvVars)[number];

/**
 * Get an environment variable with runtime validation
 */
export function getEnvVar(name: RequiredEnvVar): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Environment variable ${name} is required but not set. ` +
      `Please add it to your .env.local file.`
    );
  }
  return value;
}

/**
 * Get an optional environment variable with a fallback
 */
export function getOptionalEnvVar(
  name: OptionalEnvVar,
  fallback = ""
): string {
  return process.env[name] || fallback;
}

/**
 * Validate all required env vars (call at app startup)
 */
export function validateEnv(): void {
  for (const name of requiredEnvVars) {
    getEnvVar(name);
  }

  if (process.env.NODE_ENV === "development") {
    console.log("✅ All required environment variables are set.");
  }
}

// Auto-validate in production
if (process.env.NODE_ENV === "production") {
  validateEnv();
}
