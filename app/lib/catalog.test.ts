import { describe, expect, it } from "vitest";
import { LIMIT, listProducts } from "./catalog";

const BASE = "http://backend.test";
const PAGE = {
  items: [
    { id: "1", slug: "canvas-tote", name: "Canvas Tote", price: { amount: 2400, currency: "USD" } },
    { id: "2", slug: "wool-throw", name: "Wool Throw", price: { amount: 8900, currency: "USD" } },
  ],
  next_cursor: null,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("listProducts", () => {
  it("lists the products in the API's order, with labels made from minor units", async () => {
    const result = await listProducts(BASE, { fetch: () => Promise.resolve(json(PAGE)) });
    expect(result).toEqual({
      ok: true,
      items: [
        { slug: "canvas-tote", name: "Canvas Tote", priceLabel: "$24.00" },
        { slug: "wool-throw", name: "Wool Throw", priceLabel: "$89.00" },
      ],
    });
  });

  it("asks for one page of at most 100, with a deadline and no credentials", async () => {
    let seen: Request | undefined;
    await listProducts(BASE, {
      fetch: (request) => {
        seen = request;
        return Promise.resolve(json(PAGE));
      },
    });
    const url = new URL(seen!.url);
    expect(`${url.origin}${url.pathname}`).toBe(`${BASE}/v1/products`);
    expect(url.searchParams.get("limit")).toBe(String(LIMIT));
    expect(seen!.signal).toBeInstanceOf(AbortSignal);
    expect(seen!.headers.has("cookie")).toBe(false);
    expect(seen!.headers.has("authorization")).toBe(false);
  });

  it("gives up after the timeout", async () => {
    const hang = (request: Request) =>
      new Promise<Response>((_, reject) => {
        request.signal.addEventListener("abort", () => reject(request.signal.reason as Error));
      });
    const result = await listProducts(BASE, { fetch: hang, timeoutMs: 20 });
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  it("reports a network failure without throwing", async () => {
    const result = await listProducts(BASE, {
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });
    expect(result).toEqual({ ok: false, reason: "network" });
  });

  it("reports a non-2xx answer by its status", async () => {
    const problem = { title: "Internal Server Error", status: 500 };
    const result = await listProducts(BASE, { fetch: () => Promise.resolve(json(problem, 500)) });
    expect(result).toEqual({ ok: false, reason: "status", status: 500 });
  });

  it("refuses a price that isn't a whole number of minor units", async () => {
    const bad = {
      ...PAGE,
      items: [{ ...PAGE.items[0], price: { amount: 24.5, currency: "USD" } }],
    };
    const result = await listProducts(BASE, { fetch: () => Promise.resolve(json(bad)) });
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });
});
