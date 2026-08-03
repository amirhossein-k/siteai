import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AdminSettings() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">تنظیمات</h1>
        <p className="text-sm text-muted-foreground">
          مدیریت تنظیمات فروشگاه
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>اطلاعات فروشگاه</CardTitle>
          <CardDescription>
            اطلاعات پایه فروشگاه خود را مدیریت کنید
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="store-name">نام فروشگاه</Label>
            <Input id="store-name" defaultValue="فروشگاه من" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="store-phone">تلفن تماس</Label>
            <Input id="store-phone" defaultValue="۰۲۱-۱۲۳۴۵۶۷۸" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="store-address">آدرس</Label>
            <Input id="store-address" defaultValue="تهران، خیابان ولیعصر" />
          </div>
          <Button>ذخیره تغییرات</Button>
        </CardContent>
      </Card>
    </div>
  );
}
