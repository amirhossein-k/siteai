"use client";

import { SessionProvider } from "next-auth/react";
import { QueryProvider } from "./query-provider";
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
        <Toaster richColors closeButton position="top-center" />
      </QueryProvider>
    </SessionProvider>
  );
}
