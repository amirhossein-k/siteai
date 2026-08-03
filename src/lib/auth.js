import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { dbConnect } from "@/lib/dbConnect";
import User from "@/models/User";
import { rateLimit, LOGIN_LIMIT } from "@/lib/rate-limiter";

export const authOptions = {
  session: { strategy: "jwt" },

  providers: [
    CredentialsProvider({
      name: "شماره موبایل و رمز عبور",
      credentials: {
        phone: { label: "شماره موبایل", type: "text" },
        password: { label: "رمز عبور", type: "password" },
      },
      async authorize(credentials, req) {
        // Rate limit by phone (targeted) and IP (global)
        const ip =
          req?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
          req?.headers?.["x-real-ip"] ||
          "unknown";
        const phone = credentials?.phone;

        // Rate limit by phone — prevents brute-force on a specific account
        if (phone) {
          const rl = await rateLimit(`login:${phone}`, LOGIN_LIMIT);
          if (rl.limited) return null;
        }

        // Rate limit by IP — prevents distributed brute-force across accounts
        const ipRl = await rateLimit(`login_ip:${ip}`, {
          max: 30,
          windowMs: 15 * 60 * 1000,
        });
        if (ipRl.limited) return null;

        await dbConnect();

        const user = await User.findOne({ phone });
        if (!user || !user.passwordHash) return null;

        const isValid = await bcrypt.compare(
          credentials.password,
          user.passwordHash,
        );
        if (!isValid) return null;

        // این آبجکت داخل توکن JWT ذخیره میشه
        return {
          id: user._id.toString(),
          name: user.name,
          phone: user.phone,
          role: user.role, // "customer" | "supplier" | "admin"
        };
      },
    }),
  ],

  callbacks: {
    // role رو از user به توکن منتقل کن
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.id = user.id;
      }
      return token;
    },
    // role رو از توکن به session منتقل کن تا توی صفحات در دسترس باشه
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role;
        session.user.id = token.id;
      }
      return session;
    },
  },

  pages: {
    signIn: "/login",
  },
};
