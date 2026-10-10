import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    cspViolations: string[];
    // Nuxt's production client exposes it; isHydrating turns false once the page has hydrated.
    useNuxtApp?: () => { isHydrating: boolean };
  }
}

/**
 * Records what must never happen on a page: CSP violations (from a listener added before any of the
 * page's own code runs), uncaught errors, console errors (Vue reports hydration mismatches there), and
 * requests to any origin but the storefront's.
 */
async function watch(page: Page, baseURL: string) {
  const problems: string[] = [];
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.cspViolations.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("dialog", (dialog) => {
    problems.push(`dialog: ${dialog.message()}`);
    void dialog.dismiss();
  });
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console error: ${message.text()}`);
  });
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(baseURL).origin) {
      problems.push(`cross-origin request: ${request.url()}`);
    }
  });
  return problems;
}

const violations = (page: Page) => page.evaluate(() => window.cspViolations);

async function expectCatalog(page: Page) {
  await expect(page).toHaveURL(/\/products$/);
  await expect(page.locator("[data-product]")).toHaveCount(6);
  // Hydrated: Vue only adds data-v-app on a fresh mount, so ask Nuxt instead.
  await expect.poll(() => page.evaluate(() => window.useNuxtApp?.().isHydrating)).toBe(false);
}

test("the home page loads cleanly and links to the products", async ({ page, baseURL }) => {
  const problems = await watch(page, baseURL!);
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator('a[href="/products"]')).toBeVisible();
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test("the products page renders, hydrates and stays clean", async ({ page, baseURL }) => {
  const problems = await watch(page, baseURL!);
  const response = await page.goto("/products");
  expect(response?.status()).toBe(200);
  await expectCatalog(page);
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test("the home page's link reaches the products", async ({ page, baseURL }) => {
  const problems = await watch(page, baseURL!);
  await page.goto("/");
  await page.locator('a[href="/products"]').click();
  await expectCatalog(page);
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test("the violation detector catches a script without the nonce", async ({ page, baseURL }) => {
  await watch(page, baseURL!);
  // Rewrites the page after nuxt-security has run, keeping its headers and so its policy.
  await page.route("**/products", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      "</body>",
      "<script>document.title = 'planted'</script></body>",
    );
    await route.fulfill({ response, body });
  });
  await page.goto("/products");
  await expect.poll(() => violations(page)).not.toEqual([]);
  await expect(page).not.toHaveTitle("planted");
});

test("a product name holding markup stays text", async ({ page, baseURL }) => {
  // fragment-smoke.sh plants the name and sets HOSTILE_SLUG; the test needs that data.
  const slug = process.env.HOSTILE_SLUG;
  test.skip(!slug, "needs the planted name (HOSTILE_SLUG)");
  const problems = await watch(page, baseURL!);
  await page.goto("/products");
  await expect(page.locator(`[data-product="${slug}"] .product-name`)).toHaveText(
    "</script><script>alert(1)</script>",
  );
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);
});
