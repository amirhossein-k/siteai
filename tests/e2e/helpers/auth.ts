import type { APIRequestContext } from "@playwright/test";

/**
 * API-driven login (the exact pattern every regression suite uses):
 *   1. GET /api/auth/csrf  → capture csrfToken + cookies
 *   2. POST /api/auth/callback/credentials with the csrf token
 *   3. verify the session is live via GET /api/auth/session
 *
 * Returns an authenticated APIRequestContext whose cookies include the
 * `next-auth.session-token`. Used by global-setup to produce storageState
 * files for the admin/supplier/customer roles.
 */
export async function apiLogin(
  ctx: APIRequestContext,
  phone: string,
  password: string
): Promise<void> {
  const csrfRes = await ctx.get("/api/auth/csrf");
  if (csrfRes.status() !== 200) {
    throw new Error(`GET /api/auth/csrf failed with ${csrfRes.status()}`);
  }
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  const res = await ctx.post("/api/auth/callback/credentials", {
    form: { csrfToken, phone, password, json: "true" },
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });

  if (res.status() !== 200) {
    throw new Error(`Login for ${phone} failed with ${res.status()}`);
  }

  const sessionRes = await ctx.get("/api/auth/session");
  const session = (await sessionRes.json()) as {
    user?: { role?: string } | null;
  };
  if (!session?.user) {
    throw new Error(`Session missing after login for ${phone}`);
  }
}
