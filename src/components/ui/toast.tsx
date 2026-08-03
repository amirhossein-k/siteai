"use client";

import { toast } from "sonner";

/**
 * Toast notification helpers using Sonner
 */
export const showToast = {
  success: (message: string) =>
    toast.success(message, {
      duration: 3000,
      position: "top-center",
    }),
  error: (message: string) =>
    toast.error(message, {
      duration: 5000,
      position: "top-center",
    }),
  info: (message: string) =>
    toast.info(message, {
      duration: 3000,
      position: "top-center",
    }),
  warning: (message: string) =>
    toast.warning(message, {
      duration: 4000,
      position: "top-center",
    }),
  promise: <T,>(
    promise: Promise<T>,
    messages: { loading: string; success: string; error: string }
  ) =>
    toast.promise(promise, {
      loading: messages.loading,
      success: messages.success,
      error: messages.error,
      position: "top-center",
    }),
};
