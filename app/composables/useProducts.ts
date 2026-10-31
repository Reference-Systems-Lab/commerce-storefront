import type { CatalogResult } from "~/lib/catalog";

/**
 * The catalog for the products page. It is read on the server only: the browser gets it from the
 * page's payload and never calls the API (D-7). The SDK and the API's address stay out of the
 * browser's bundle, because both are reached only inside the server branch (REQ-010, REQ-022).
 */
export function useProducts() {
  return useAsyncData("products", async (nuxtApp): Promise<CatalogResult> => {
    if (!import.meta.server) return { ok: false, reason: "network" };
    const { listProducts } = await import("~/lib/catalog");
    return listProducts(nuxtApp.$config.apiBaseUrl);
  });
}
