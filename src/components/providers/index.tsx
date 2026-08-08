"use client";

import { SessionProvider } from "next-auth/react";
import { QueryProvider } from "./query-provider";
import { CartOwnerSync } from "./cart-owner-sync";
import { Toaster } from "@/components/ui/sonner";
import { type ReactNode } from "react";

interface ProvidersProps {
  children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider>
      <QueryProvider>
        {children}
        {/* Swaps the persisted cart to the signed-in user's isolated key on
            login/logout/account switch (never renders anything). */}
        <CartOwnerSync />
        <Toaster richColors closeButton position="top-center" />
      </QueryProvider>
    </SessionProvider>
  );
}
