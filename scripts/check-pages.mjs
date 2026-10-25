// Checks what the storefront's pages show, against a running server and the seeded backend
// (REQ-005, REQ-006, REQ-010): node scripts/check-pages.mjs <base-url> [--hostile <slug>]
// With --hostile, that product's name holds markup (fragment-smoke.sh plants it), and the page must
// show it as text, both in the HTML and in the payload.
const base = process.argv[2]?.replace(/\/$/, "");
const hostileAt = process.argv.indexOf("--hostile");
const hostile = hostileAt > 0 ? process.argv[hostileAt + 1] : undefined;
if (!base || (hostileAt > 0 && !hostile)) {
  process.stderr.write("usage: node scripts/check-pages.mjs <base-url> [--hostile <slug>]\n");
  process.exit(2);
}

// The development catalog the backend seeds (commerce-backend v0.1.0, internal/catalog/seed.go), in
// the API's order, with the labels the storefront must make from its minor units.
const SEEDED = [
  ["canvas-tote", "Canvas Tote", "$24.00"],
  ["ceramic-mug", "Ceramic Mug", "$18.00"],
  ["linen-apron", "Linen Apron", "$36.00"],
  ["oak-cutting-board", "Oak Cutting Board", "$52.00"],
  ["wool-throw", "Wool Throw", "$89.00"],
  ["beeswax-candle", "Beeswax Candle", "$15.00"],
];
// What fragment-smoke.sh plants as a name, and how Vue must write it into the HTML.
const PLANTED = "</script><script>alert(1)</script>";
const ESCAPED = "&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;";
// The API's address and paths never reach the browser (REQ-010).
const LEAKS = /backend-api|:8080|\/v1\/|apiBaseUrl/;

const problems = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);
const count = (html, pattern) => (html.match(pattern) ?? []).length;

async function page(path) {
  const response = await fetch(`${base}${path}`, { headers: { accept: "text/html" } });
  return { status: response.status, html: await response.text() };
}

const products = await page("/products");
if (products.status !== 200) fail("/products", `status ${products.status}`);
if (count(products.html, /<title>/g) !== 1) fail("/products", "doesn't have exactly one <title>");
if (count(products.html, /<h1[\s>]/g) !== 1) fail("/products", "doesn't have exactly one <h1>");
const items = [
  ...products.html.matchAll(
    /data-product="([^"]*)"[^>]*>\s*<span class="product-name">([^<]*)<\/span>[\s\S]*?<span class="product-price">([^<]*)<\/span>/g,
  ),
].map(([, slug, name, label]) => [slug, name, label]);
const want = SEEDED.map(([slug, name, label]) => [slug, slug === hostile ? ESCAPED : name, label]);
if (JSON.stringify(items) !== JSON.stringify(want)) {
  fail("/products", `lists ${JSON.stringify(items)}, want ${JSON.stringify(want)}`);
}
const leak = LEAKS.exec(products.html);
if (leak) fail("/products", `the HTML or payload holds "${leak[0]}"`);
if (hostile) {
  if (products.html.includes(PLANTED)) fail("/products", "the planted markup reaches the page raw");
  const payload = /<script[^>]*id="__NUXT_DATA__"[^>]*>([^<]*)<\/script>/.exec(products.html)?.[1];
  if (!payload?.includes("\\u003C\\u002Fscript>"))
    fail("/products", "the payload doesn't escape the planted name");
}

const home = await page("/");
if (home.status !== 200) fail("/", `status ${home.status}`);
if (!/<html[^>]*\slang="en"/.test(home.html)) fail("/", 'lacks <html lang="en">');
if (count(home.html, /<title>/g) !== 1) fail("/", "doesn't have exactly one <title>");
if (count(home.html, /<h1[\s>]/g) !== 1) fail("/", "doesn't have exactly one <h1>");
if (!home.html.includes('<a href="/products">')) fail("/", "doesn't link to /products");
if (/data-product|\$\d/.test(home.html)) fail("/", "shows a product or a price");

for (const problem of problems) process.stdout.write(`${problem}\n`);
process.stdout.write(
  problems.length === 0 ? "pages: ok\n" : `pages: ${problems.length} problem(s)\n`,
);
process.exitCode = problems.length === 0 ? 0 : 1;
