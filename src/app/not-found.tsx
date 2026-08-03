import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h1 className="text-8xl font-bold tracking-tight text-zinc-200 dark:text-zinc-800">
          ۴۰۴
        </h1>
        <h2 className="mt-4 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          صفحه مورد نظر یافت نشد
        </h2>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          صفحه‌ای که به دنبال آن هستید وجود ندارد یا حذف شده است.
        </p>
      </div>
      <Link href="/">
        <Button size="lg">بازگشت به صفحه اصلی</Button>
      </Link>
    </div>
  );
}
