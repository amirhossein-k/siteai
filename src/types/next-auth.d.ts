import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      phone: string;
      role: "customer" | "supplier" | "admin";
      image?: string | null;
    };
  }

  interface User {
    id: string;
    name: string;
    phone: string;
    role: "customer" | "supplier" | "admin";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: "customer" | "supplier" | "admin";
  }
}
