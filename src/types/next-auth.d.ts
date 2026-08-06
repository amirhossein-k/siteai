import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      phone: string;
      role: "customer" | "supplier" | "admin";
      // Session 62 — session-revocation foundation (additive).
      tokenVersion?: number;
      image?: string | null;
    };
  }

  interface User {
    id: string;
    name: string;
    phone: string;
    role: "customer" | "supplier" | "admin";
    tokenVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    // Optional: JWTs minted before Session 62 carry no phone claim (they
    // expire naturally within the 30-day maxAge).
    phone?: string;
    role: "customer" | "supplier" | "admin";
    tokenVersion?: number;
  }
}
