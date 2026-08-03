"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Simple Slot component that merges its props onto its single child element.
 * This replaces @radix-ui/react-slot when the package is not available.
 */
const Slot = React.forwardRef<
  HTMLElement,
  React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }
>(({ children, ...props }, ref) => {
  if (!children || !React.isValidElement(children)) {
    return null;
  }

  return React.cloneElement(children, {
    ...mergeProps(props, children.props),
    // React 19: ref is now a regular prop, access via children.props.ref
    ref: mergeRefs(ref, (children.props as any).ref),
  } as React.HTMLAttributes<HTMLElement>);
});
Slot.displayName = "Slot";

function mergeProps(parent: any, child: any) {
  const merged: any = { ...parent };

  for (const key in child) {
    if (key === "className") {
      merged.className = cn(child.className, parent.className);
    } else if (key === "style") {
      merged.style = { ...child.style, ...parent.style };
    } else if (!merged[key]) {
      merged[key] = child[key];
    }
  }

  return merged;
}

function mergeRefs(...refs: any[]) {
  return (value: any) => {
    for (const ref of refs) {
      if (typeof ref === "function") {
        ref(value);
      } else if (ref && typeof ref === "object") {
        ref.current = value;
      }
    }
  };
}

export { Slot };
