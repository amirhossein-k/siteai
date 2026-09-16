import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";

// این proxy قبل از رندر صفحات /admin و /supplier اجرا میشه
// و اگه نقش کاربر درست نباشه، به صفحه‌ی اصلی ریدایرکت می‌کنه
// (Session 89 — Next.js 16 renamed the `middleware` file convention to `proxy`.)
export async function proxy(req) {
  const { pathname } = req.nextUrl;
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  const isAdminRoute = pathname.startsWith("/admin");
  const isSupplierRoute = pathname.startsWith("/supplier");

  if ((isAdminRoute || isSupplierRoute) && !token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (isAdminRoute && token?.role !== "admin") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (isSupplierRoute && token?.role !== "supplier") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/supplier/:path*"],
};
