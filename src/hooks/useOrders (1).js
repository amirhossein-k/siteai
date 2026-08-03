import useSWR from "swr";
import axios from "axios";

const fetcher = (url) => axios.get(url).then((res) => res.data);

// برای مشتری: سفارش‌های خودش
export function useOrders() {
  const { data, error, isLoading, mutate } = useSWR("/api/orders", fetcher, {
    refreshInterval: 15000, // هر ۱۵ ثانیه رفرش، شبیه real-time
  });

  return {
    orders: data,
    isLoading,
    isError: error,
    mutate,
  };
}

// برای پنل فروشنده: زیرسفارش‌های همون فروشنده
export function useSupplierOrders(status) {
  const query = status ? `?status=${status}` : "";
  const { data, error, isLoading, mutate } = useSWR(
    `/api/supplier/orders${query}`,
    fetcher,
    { refreshInterval: 15000 }
  );

  return {
    orders: data,
    isLoading,
    isError: error,
    mutate,
  };
}
