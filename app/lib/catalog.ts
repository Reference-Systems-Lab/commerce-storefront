import { createClient, type Product } from "@reference-systems-lab/commerce-api";
import { formatMoney } from "./money";

/** What the products page shows for one product. The label is made on the server (D-10). */
interface CatalogItem {
  slug: string;
  name: string;
  priceLabel: string;
}

/** The catalog, or why it couldn't be read. Never a thrown error, and never the backend's details. */
export type CatalogResult =
  | { ok: true; items: CatalogItem[] }
  | { ok: false; reason: "timeout" | "network" | "invalid" }
  | { ok: false; reason: "status"; status: number };

export interface CatalogOptions {
  /** Stands in for the global fetch in tests. */
  fetch?: (request: Request) => Promise<Response>;
  timeoutMs?: number;
}

/** One page is the whole catalog for now; the backend allows at most 100 (D-9). */
export const LIMIT = 100;
const TIMEOUT_MS = 3000;

/** Reads the catalog from the backend through the SDK. Server-side only: `baseUrl` is private. */
export async function listProducts(
  baseUrl: string,
  { fetch, timeoutMs = TIMEOUT_MS }: CatalogOptions = {},
): Promise<CatalogResult> {
  const client = createClient({ baseUrl, ...(fetch ? { fetch } : {}) });
  let result;
  try {
    // openapi-fetch throws on network failures and aborts, and returns everything else.
    result = await client.GET("/v1/products", {
      params: { query: { limit: LIMIT } },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { ok: false, reason: isTimeout(error) ? "timeout" : "network" };
  }
  const { data, response } = result;
  if (!response.ok || data === undefined)
    return { ok: false, reason: "status", status: response.status };
  try {
    return { ok: true, items: data.items.map(toItem) };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

function toItem({ slug, name, price }: Product): CatalogItem {
  return { slug, name, priceLabel: formatMoney(price) };
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError";
}
