import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { dbConnect } from "@/lib/dbConnect";
import User from "@/models/User";
import OtpCode from "@/models/OtpCode";
import { rateLimit, LOGIN_LIMIT } from "@/lib/rate-limiter";
import { hashLoginToken } from "@/lib/otp";

export const authOptions = {
  session: { strategy: "jwt" },

  providers: [
    CredentialsProvider({
      name: "شماره موبایل و رمز عبور",
      credentials: {
        phone: { label: "شماره موبایل", type: "text" },
        password: { label: "رمز عبور", type: "password" },
        // Session 62 — OTP one-time login token (optional; password path
        // is untouched when absent).
        loginToken: { label: "توکن ورود یکبارمصرف", type: "password" },
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

        // --- Session 62 — OTP one-time login-token branch (additive) ---
        // The token is issued by POST /api/auth/otp/verify and exchanged
        // exactly once: authorize() claims the row atomically, so a replayed
        // token loses the update and returns null (replay-proof).
        const loginToken = credentials?.loginToken;
        if (loginToken) {
          const otpDoc = await OtpCode.findOne({
            loginTokenHash: hashLoginToken(loginToken),
          });
          if (!otpDoc) return null;
          if (otpDoc.phone !== phone) return null;
          if (otpDoc.consumedAt) return null;
          if (
            !otpDoc.loginTokenExpiresAt ||
            new Date(otpDoc.loginTokenExpiresAt).getTime() <= Date.now()
          ) {
            return null;
          }

          // Atomic claim — a concurrent replay loses the update.
          const claimed = await OtpCode.updateOne(
            { _id: otpDoc._id, consumedAt: null },
            { $set: { consumedAt: new Date() } }
          );
          if (claimed.modifiedCount !== 1) return null;

          const otpUser = await User.findOne({ phone });
          if (!otpUser) return null;

          return {
            id: otpUser._id.toString(),
            name: otpUser.name,
            phone: otpUser.phone,
            role: otpUser.role, // "customer" | "supplier" | "admin"
            tokenVersion: otpUser.tokenVersion ?? 0,
          };
        }

        // --- Password branch (unchanged) ---
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
          tokenVersion: user.tokenVersion ?? 0,
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
        // Session 62 — phone was declared on Session.user but never copied;
        // completing the contract (additive — password path unchanged).
        token.phone = user.phone;
        // Session 62 — session-revocation foundation: stored at sign-in so a
        // future tokenVersion bump invalidates old JWTs.
        token.tokenVersion = user.tokenVersion ?? 0;
      }
      return token;
    },
    // role رو از توکن به session منتقل کن تا توی صفحات در دسترس باشه
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role;
        session.user.id = token.id;
        session.user.phone = token.phone;
        session.user.tokenVersion = token.tokenVersion ?? 0;
      }
      return session;
    },
  },

  pages: {
    signIn: "/login",
  },
};
