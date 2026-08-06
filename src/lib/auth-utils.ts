/**
 * Centralized Authentication & Authorization Utilities (RBAC)
 *
 * Every API route should use these helpers instead of duplicating
 * getToken() + role checks. This ensures consistent auth logic
 * across the entire application.
 *
 * Usage:
 *   import { requireRoleOrError, requireAuth } from "@/lib/auth-utils";
 *
 *   // Require any authenticated user
 *   const token = await requireAuth(req);
 *   if (!token) return unauthorized();
 *
 *   // Require specific roles
 *   const { token, error } = await requireRoleOrError(req, ["admin"]);
 *   const { token, error } = await requireRoleOrError(req, ["admin", "supplier"]);
 *   if (error) return error;
 */

import { NextResponse, NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  createTokenVersionChecker,
  evictTokenVersionCacheEntry,
} from "@/lib/token-version";
import { dbConnect } from "@/lib/dbConnect";
import User from "@/models/User";

// ============================================================
// Types
// ============================================================

export type UserRole = "customer" | "supplier" | "admin";

/**
 * The server-side token shape returned by getToken().
 * This is read-only — never serialize the full token to the client.
 */
export interface ServerToken {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
  tokenVersion?: number;
  email?: string;
  picture?: string;
  sub?: string;
  iat?: number;
  exp?: number;
  jti?: string;
}

// ============================================================
// Core Helpers
// ============================================================

const SECRET = process.env.NEXTAUTH_SECRET;

// ============================================================
// Session 64 — tokenVersion revocation enforcement
// ============================================================
// The checker is created once per module load and its per-user cache lives
// on globalThis so dev-server HMR does not reset it (mirrors the
// notification-stream pattern). Default TTL = 60s: a tokenVersion bump
// (change-password / logout-all / admin revoke) invalidates all previously
// issued JWTs within that window. Fail-open on checker errors (see the
// token-version module docs) — never break authentication on a DB blip.
const g = globalThis as unknown as {
  __tokenVersionCache?: Map<string, { version: number; checkedAt: number }>;
};
const tokenVersionCache =
  g.__tokenVersionCache ?? (g.__tokenVersionCache = new Map());

const isTokenVersionCurrent = createTokenVersionChecker({
  cache: tokenVersionCache,
  fetchUserVersion: async (userId: string): Promise<number | null> => {
    await dbConnect();
    const user = (await User.findById(userId)
      .select("tokenVersion")
      .lean()) as { tokenVersion?: number } | null;
    return user ? (user.tokenVersion ?? 0) : null;
  },
  onError: (err) =>
    console.error("[token-version] check failed (fail-open):", err),
});

/**
 * Session 64 — evict a user's tokenVersion cache entry. Called by the
 * in-process bumping routes (change-password / logout-all / admin revoke)
 * right after the $inc, so the revocation is IMMEDIATE in the same server
 * instead of waiting out the 60s cache TTL.
 */
export function invalidateTokenVersionCache(userId: string | undefined): void {
  evictTokenVersionCacheEntry(tokenVersionCache, userId);
}

/**
 * Extract and validate the JWT token from a request.
 * Returns null if the user is not authenticated — INCLUDING a revoked
 * session (token.tokenVersion is stale vs the User's current tokenVersion).
 */
export async function getServerToken(
  req: NextRequest
): Promise<ServerToken | null> {
  try {
    const token = await getToken({ req, secret: SECRET });
    if (!token) return null;
    const serverToken = token as unknown as ServerToken;
    // Session 64 — revocation gate: a bumped tokenVersion invalidates the JWT.
    if (!(await isTokenVersionCurrent(serverToken.id, serverToken.tokenVersion))) {
      return null;
    }
    return serverToken;
  } catch {
    return null;
  }
}

/**
 * Require any authenticated user.
 * Returns the token if authenticated, or sends a 401 response.
 *
 * Usage:
 *   const token = await requireAuth(req);
 *   if (!token) return; // 401 already sent
 */
export async function requireAuth(
  req: NextRequest
): Promise<ServerToken | null> {
  const token = await getServerToken(req);
  if (!token) {
    return null;
  }
  return token;
}

/**
 * Require one of the specified roles and return the correct 401/403 response.
 *
 * Usage:
 *   const { token, error } = await requireRoleOrError(req, ["admin"]);
 *   if (error) return error;
 *
 * Returns:
 *   - 401 if the user is not authenticated
 *   - 403 if the user is authenticated but lacks the required role
 *   - { token, error: null } if authorized
 */
export async function requireRoleOrError(
  req: NextRequest,
  allowedRoles: UserRole[]
): Promise<{ token: ServerToken | null; error: NextResponse | null }> {
  const token = await getServerToken(req);
  if (!token) {
    return { token: null, error: unauthorized() };
  }
  if (!allowedRoles.includes(token.role)) {
    return { token: null, error: forbidden() };
  }
  return { token, error: null };
}

// ============================================================
// Response Helpers
// ============================================================

/**
 * Standard 401 Unauthorized response (not logged in).
 */
export function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: "لطفاً ابتدا وارد حساب خود شوید" },
    { status: 401 }
  );
}

/**
 * Standard 403 Forbidden response (wrong role).
 */
export function forbidden(): NextResponse {
  return NextResponse.json(
    { error: "شما دسترسی به این بخش را ندارید" },
    { status: 403 }
  );
}

/**
 * Standard 500 Internal Server Error response.
 *
 * Note: Callers should log their own context-specific error message
 * before calling this helper. This function only returns the response
 * to avoid double-logging.
 */
export function serverError(): NextResponse {
  return NextResponse.json(
    { error: "خطای سرور" },
    { status: 500 }
  );
}

// ============================================================
// Role Check Shortcuts
// ============================================================

/**
 * Check if token has admin role.
 */
export function isAdmin(token: ServerToken | null): boolean {
  return token?.role === "admin";
}

/**
 * Check if token has supplier role.
 */
export function isSupplier(token: ServerToken | null): boolean {
  return token?.role === "supplier";
}

/**
 * Check if token has customer role.
 */
export function isCustomer(token: ServerToken | null): boolean {
  return token?.role === "customer";
}
