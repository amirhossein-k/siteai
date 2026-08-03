"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type { SupplierProduct } from "@/types";
import type { ProductFormData } from "@/lib/validations/product";

export const supplierProductKeys = {
  all: ["supplier", "products"] as const,
  lists: () => [...supplierProductKeys.all, "list"] as const,
  details: () => [...supplierProductKeys.all, "detail"] as const,
  detail: (id: string) => [...supplierProductKeys.details(), id] as const,
};

const fetchSupplierProducts = async (): Promise<SupplierProduct[]> => {
  const { data } = await axios.get("/api/supplier/products");
  return data;
};

const fetchSupplierProduct = async (id: string): Promise<SupplierProduct> => {
  const { data } = await axios.get(`/api/supplier/products?id=${id}`);
  return data;
};

const createSupplierProduct = async (
  product: ProductFormData
): Promise<SupplierProduct> => {
  const { data } = await axios.post("/api/supplier/products", product);
  return data;
};

const updateSupplierProduct = async ({
  id,
  ...product
}: ProductFormData & { id: string }): Promise<SupplierProduct> => {
  const { data } = await axios.put(
    `/api/supplier/products?id=${id}`,
    product
  );
  return data;
};

const deleteSupplierProduct = async (id: string): Promise<void> => {
  await axios.delete(`/api/supplier/products?id=${id}`);
};

const updateSupplierVariantStock = async ({
  productId,
  variantId,
  stock,
}: {
  productId: string;
  variantId: string;
  stock: number;
}): Promise<SupplierProduct> => {
  const { data } = await axios.post("/api/supplier/products/stock", {
    productId,
    variantId,
    stock,
  });
  return data;
};

export function useSupplierProducts() {
  return useQuery({
    queryKey: supplierProductKeys.lists(),
    queryFn: fetchSupplierProducts,
  });
}

export function useSupplierProduct(id: string) {
  return useQuery({
    queryKey: supplierProductKeys.detail(id),
    queryFn: () => fetchSupplierProduct(id),
    enabled: !!id,
  });
}

export function useCreateSupplierProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createSupplierProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: supplierProductKeys.lists(),
      });
    },
  });
}

export function useUpdateSupplierProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateSupplierProduct,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: supplierProductKeys.lists(),
      });
      queryClient.invalidateQueries({
        queryKey: supplierProductKeys.detail(data._id),
      });
    },
  });
}

export function useDeleteSupplierProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteSupplierProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: supplierProductKeys.lists(),
      });
    },
  });
}

export function useUpdateSupplierVariantStock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateSupplierVariantStock,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: supplierProductKeys.lists(),
      });
      queryClient.invalidateQueries({
        queryKey: supplierProductKeys.detail(data._id),
      });
    },
  });
}
