"use client";

import { useState } from "react";
import Link from "next/link";
import { Store, Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PublicSupplier } from "@/types";

interface SupplierCardProps {
  supplier: PublicSupplier;
  className?: string;
}

export function SupplierCard({ supplier, className }: SupplierCardProps) {
  const [logoError, setLogoError] = useState(false);
  const showLogo = !!supplier.logo && !logoError;

  return (
    <Link href={`/suppliers/${supplier._id}`}>
      <Card
        className={cn(
          "group relative overflow-hidden rounded-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-lg",
          className
        )}
      >
        <CardContent className="p-5">
          {/* Logo / Initial */}
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-muted to-muted/50">
              {showLogo ? (
                <img
                  src={supplier.logo}
                  alt={supplier.businessName}
                  className="h-full w-full object-cover"
                  onError={() => setLogoError(true)}
                />
              ) : (
                <Store className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-base font-bold transition-colors group-hover:text-primary">
                {supplier.businessName}
              </h3>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <Package className="h-3 w-3" />
                {supplier.productCount.toLocaleString("fa-IR")} محصول
              </p>
            </div>
          </div>

          {/* Description */}
          {supplier.description ? (
            <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
              {supplier.description}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground/60">
              فروشگاه {supplier.businessName}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
