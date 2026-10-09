// Checks the storefront's security headers, CSP and SRI against a running server (REQ-011, REQ-008,
// REQ-021): node scripts/check-headers.mjs <base-url> [--unavailable]
// With --unavailable it expects the backend to be down and checks the 503 instead of the catalog.
// Prints one line per problem and exits non-zero if there is any.
import { createHash } from "node:crypto";

const base = process.argv[2]?.replace(/\/$/, "");
const unavailable = process.argv.includes("--unavailable");
if (!base) {
  process.stderr.write("usage: node scripts/check-headers.mjs <base-url> [--unavailable]\n");
  process.exit(2);
}

const problems = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);

// Every page's policy, apart from script-src, which each page sets its own way (D-8).
const POLICY = {
  "default-src": ["'none'"],
  "script-src-attr": ["'none'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'"],
  "font-src": ["'self'"],
  "connect-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
};
const REQUIRED_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
};
// HSTS belongs to the proxy; the others would leak or widen access.
const FORBIDDEN_HEADERS = [
  "strict-transport-security",
  "x-powered-by",
  "access-control-allow-origin",
];

async function get(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    redirect: "manual",
    ...init,
    headers: { accept: "text/html", ...init.headers },
  });
  return { response, html: await response.text() };
}

/** Parses a policy into directive → sorted sources. A comma means two policies were sent. */
function parsePolicy(where, value) {
  if (value.includes(",")) fail(where, "more than one Content-Security-Policy");
  const policy = {};
  for (const part of value.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) policy[name.toLowerCase()] = sources.sort();
  }
  return policy;
}

function comparePolicy(where, actual, expected) {
  const names = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  for (const name of names) {
    const got = (actual[name] ?? []).join(" ");
    const want = [...(expected[name] ?? [])].sort().join(" ");
    if (!(name in actual)) fail(where, `CSP lacks ${name}`);
    else if (!(name in expected)) fail(where, `CSP has an unexpected ${name}`);
    else if (got !== want) fail(where, `CSP ${name} is "${got}", want "${want}"`);
  }
}

function checkHeaders(where, response) {
  for (const [name, value] of Object.entries(REQUIRED_HEADERS)) {
    const got = response.headers.get(name);
    if (got?.toLowerCase() !== value.toLowerCase())
      fail(where, `${name} is ${got ?? "missing"}, want ${value}`);
  }
  for (const name of FORBIDDEN_HEADERS) {
    if (response.headers.has(name)) fail(where, `sends ${name}`);
  }
}

const tags = (html, name) =>
  [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "gi"))].map((m) => m[1]);
const attributes = (raw) =>
  Object.fromEntries(
    [...raw.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)].map((m) => [m[1].toLowerCase(), m[2] ?? ""]),
  );
const inlineScripts = (html) =>
  [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .map((m) => ({ attrs: attributes(m[1]), body: m[2] }))
    .filter(({ attrs }) => !("src" in attrs));

/** Every <script src> and stylesheet or modulepreload <link> carries the file's SHA-384. */
async function checkIntegrity(where, html) {
  const refs = [
    ...tags(html, "script")
      .map(attributes)
      .filter((a) => a.src),
    ...tags(html, "link")
      .map(attributes)
      .filter((a) => /^(stylesheet|modulepreload)$/.test(a.rel)),
  ];
  for (const ref of refs) {
    const path = ref.src ?? ref.href;
    if (!ref.integrity?.startsWith("sha384-")) {
      fail(where, `${path} has no sha384 integrity`);
      continue;
    }
    const body = Buffer.from(await (await fetch(`${base}${path}`)).arrayBuffer());
    const digest = `sha384-${createHash("sha384").update(body).digest("base64")}`;
    if (ref.integrity !== digest) fail(where, `${path} integrity doesn't match the file`);
  }
}

function checkMarkup(where, html) {
  if (/<style\b/i.test(html)) fail(where, "has a <style> element");
  if (/\sstyle="/i.test(html)) fail(where, "has a style attribute");
  for (const link of tags(html, "link").map(attributes)) {
    if (link.rel === "prefetch") fail(where, `has a prefetch link to ${link.href}`);
  }
}

/** /products (or its 503): one policy with this response's nonce on every script and link. */
async function checkRendered(where, response, html) {
  const csp = response.headers.get("content-security-policy");
  if (!csp) return fail(where, "no Content-Security-Policy");
  const policy = parsePolicy(where, csp);
  const nonce = (policy["script-src"] ?? []).find((s) => s.startsWith("'nonce-"))?.slice(7, -1);
  if (!nonce) fail(where, "script-src has no nonce");
  comparePolicy(where, policy, {
    ...POLICY,
    "script-src": [`'nonce-${nonce}'`, "'strict-dynamic'"],
  });
  for (const tag of [...tags(html, "script"), ...tags(html, "link")].map(attributes)) {
    if (tag.nonce !== nonce) fail(where, `a <script> or <link> lacks this response's nonce`);
  }
  if (response.headers.get("cache-control") !== "no-store")
    fail(where, "cache-control isn't no-store");
  if (response.headers.has("set-cookie")) fail(where, "sets a cookie");
  checkHeaders(where, response);
  checkMarkup(where, html);
  await checkIntegrity(where, html);
  return nonce;
}

/** /: prerendered, so no nonce. Its policy lists a hash per inline script, which may only be rules. */
async function checkHome(where, response, html) {
  if (response.status !== 200) return fail(where, `status ${response.status}`);
  const scripts = inlineScripts(html);
  for (const { attrs } of scripts) {
    if (attrs.type !== "speculationrules")
      fail(where, `has an executable inline script (type ${attrs.type ?? "none"})`);
  }
  if (scripts.length > 1) fail(where, `has ${scripts.length} inline scripts, want at most one`);
  for (const attrs of tags(html, "script").map(attributes)) {
    if (attrs.src) fail(where, `loads a script: ${attrs.src}`);
  }
  for (const link of tags(html, "link").map(attributes)) {
    if (link.rel === "modulepreload") fail(where, `preloads a module: ${link.href}`);
  }
  const hashes = scripts.map(
    ({ body }) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`,
  );
  const csp = response.headers.get("content-security-policy");
  if (!csp) return fail(where, "no Content-Security-Policy header");
  const policy = parsePolicy(where, csp);
  // 'inline-speculation-rules' is allowed only if Chromium turns out to need it (D-1).
  const extra = (policy["script-src"] ?? []).filter((s) => s === "'inline-speculation-rules'");
  comparePolicy(where, policy, {
    ...POLICY,
    "script-src": ["'strict-dynamic'", ...hashes, ...extra],
  });

  const meta = tags(html, "meta")
    .map(attributes)
    .find((a) => a["http-equiv"]?.toLowerCase() === "content-security-policy");
  if (!meta) fail(where, "has no <meta> copy of the policy");
  else {
    // A <meta> policy can't carry frame-ancestors, so the copy lacks it.
    const withoutFrames = { ...policy };
    delete withoutFrames["frame-ancestors"];
    comparePolicy(`${where} <meta>`, parsePolicy(where, meta.content), withoutFrames);
  }
  checkHeaders(where, response);
  checkMarkup(where, html);
  await checkIntegrity(where, html);
}

if (unavailable) {
  const { response, html } = await get("/products");
  if (response.status !== 503)
    fail("/products", `status ${response.status}, want 503 with the backend down`);
  await checkRendered("/products (503)", response, html);
} else {
  const first = await get("/products");
  const second = await get("/products");
  for (const { response } of [first, second]) {
    if (response.status !== 200) fail("/products", `status ${response.status}`);
  }
  const a = await checkRendered("/products", first.response, first.html);
  const b = await checkRendered("/products", second.response, second.html);
  if (a && a === b) fail("/products", "two responses share a nonce");

  const home = await get("/");
  await checkHome("/", home.response, home.html);

  // The prerendered file is either redirected to / or served with the same policy (D-20).
  const file = await get("/index.html");
  const location = file.response.headers.get("location");
  if ([301, 308].includes(file.response.status)) {
    if (location !== "/") fail("/index.html", `redirects to ${location}, want /`);
  } else {
    await checkHome("/index.html", file.response, file.html);
  }

  const post = await get("/products", { method: "POST" });
  if (post.response.status !== 405)
    fail("POST /products", `status ${post.response.status}, want 405`);
}

for (const problem of problems) process.stdout.write(`${problem}\n`);
process.stdout.write(
  problems.length === 0 ? "headers: ok\n" : `headers: ${problems.length} problem(s)\n`,
);
process.exitCode = problems.length === 0 ? 0 : 1;
