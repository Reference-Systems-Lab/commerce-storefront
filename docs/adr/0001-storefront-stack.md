# 1. The storefront's stack

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

The storefront is the public face of the business: marketing, discovery and buying. It reaches the
rest of the platform only through the backend's API, using the SDK generated from it
(`@reference-systems-lab/commerce-api`), and it styles itself with the design system's tokens and
shared configs. The platform runs it locally from an image and a compose fragment, behind the proxy
that terminates TLS for `rsl-commerce.test`.

The spike (commerce-storefront#1) compared Nuxt, Astro and hand-rolled Vite SSR, and decided D1 to
D8. The walking skeleton (commerce-storefront#2) builds the first slice:

- a prerendered home page;
- a server-rendered `/products` page that lists the catalog through the SDK;
- the image, the fragment, CI and the release.

This record covers both. Where the skeleton changed a spike decision, it says so.

## Decision

- **Framework.** Nuxt 4 on Nitro's node-server preset, with `future.compatibilityVersion: 5` so the
  Nuxt 5 upgrade stays small (#1 D1).
  - Nuxt is pinned exactly to the newest release at least seven days old. If 4.6's renderer breaks
    the CSP, 4.5.2 is the fallback (#2 D-1).
  - `nuxt/server` isn't used yet.
  - There are no server islands or server components (#1 D5).
- **Rendering by route.** Pages that show no price are prerendered. Pages that show prices are
  server-rendered on every request, with no `swr`, `isr` or cache rule, and send
  `Cache-Control: no-store` (#1 D2). The skeleton has one of each:
  - `/` is prerendered with `noScripts`: a static page that links to `/products` with a plain `<a>`;
  - `/products` is server-rendered (#2 D-7).
- **Data.** Server-rendered reads use `useAsyncData` with the SDK's openapi-fetch client (#1 D3).
  - The client is imported only on the server, and its base URL lives in private runtime config.
  - In the skeleton, the browser makes no API call: it hydrates from the payload.
  - Browser calls arrive with sign-in, along with Pinia Colada and the session cookie on the API
    host (#1 D3, D4; commerce#3 DE-9).
- **Reaching the backend (RQ-1).** The Nuxt server calls the backend directly at
  `http://backend-api:8080` on the platform's internal `edge` network, set by
  `STOREFRONT_API_BASE_URL` (#2 D-6). Going through the proxy at `api.rsl-commerce.test` would need
  the proxy's name to resolve inside containers and its development CA to be trusted inside a
  distroless image, and it would assume how the platform provisions TLS. Each request:
  - times out after 3 seconds and asks for at most 100 products;
  - turns any failure into a 503 from a generic error page that reveals nothing about the backend
    (#2 D-9).
- **Prices.** The backend decides prices, and the storefront only formats them (#2 D-10):
  - it formats the `{amount, currency}` minor units on the server with `Intl.NumberFormat('en-US')`
    and decimal-string input, never floating-point maths;
  - the decimal point goes where ISO 4217's minor units put it. For 16 currencies these differ from
    the digits Intl shows (CLDR); a table covers them, so no price is shown 100 times too large;
  - it sends the formatted label in the payload;
  - routes match exactly, so no other spelling of `/products` renders prices without `no-store`.
- **Security headers.** nuxt-security 2.6, with every CSP directive set explicitly rather than
  through `strict: true` (#1 D5, as changed by #2 D-8):
  - `default-src 'none'`;
  - `script-src` with a per-request nonce and `'strict-dynamic'`;
  - `style-src 'self' 'unsafe-inline'`;
  - `connect-src 'self'`;
  - `frame-ancestors 'none'`, `base-uri 'none'` and `object-src 'none'`.

  Alongside the policy:
  - every script and stylesheet carries SRI;
  - the response also sends `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, COOP and CORP;
  - only GET and HEAD are allowed.

  The prerendered home page can't carry a per-request nonce, so its policy lists a hash for each
  inline script instead. `/index.html` redirects to `/`, because Nitro serves the prerendered file
  without the page's headers (#2 D-20). A path starting with `//` still reaches that file without
  them. The page runs no script and keeps its `<meta>` policy, and the platform's proxy can normalise
  such paths. A few defaults are turned off because every request reaches the app
  through the proxy:
  - HSTS: the proxy sends it;
  - CORS;
  - the per-IP rate limiter.

- **Speculation rules.** From 4.6, Nuxt adds an inline `<script type="speculationrules">` to every
  `noScripts` page, and it can't be turned off. It's declarative, so no code runs, and nuxt-security
  hashes it into the home page's policy. In Chromium, hovering the link may prerender `/products`.
  This is accepted (#2 D-1, D-7). If Chromium refuses the hash, `'inline-speculation-rules'` is
  added; if that also fails, the storefront stays on 4.5.2.
- **Styles.** Tokens come from `@reference-systems-lab/tokens`, as the first global stylesheet.
  - CSS lives in `.css` files, never in `<style>` blocks, because the shared ESLint config lints CSS
    with `@eslint/css` (design-system#2 D-9, D-10).
  - Nuxt 4.6 inlines a `noScripts` page's own CSS as `<style>`, so the home page's rules live in the
    global stylesheet.
- **Toolchain** (commerce#3 DE-3):
  - the design system's ESLint, Prettier and tsconfig packages, with Nuxt-specific adjustments kept
    local until they move upstream (#2 D-14);
  - vue-tsc with `strictTemplates`, on TypeScript 6.0, with `noFallthroughCasesInSwitch` set in every
    project Nuxt generates (#2 D-22);
  - Vitest 5, Playwright 1.63 in three engines, and Knip.
- **Supply chain.** The hardened `.npmrc` (commerce#3 DE-2):
  - no install scripts run; any package that has one is named in `allowScripts` and set to `false`;
  - packages must be at least seven days old, except our own scope;
  - no git or remote installs.

  The tree's install scripts, esbuild's and macOS-only fsevents', are denied. esbuild finds its
  binary in its optional platform package (#2 D-5). `simple-git` is overridden to 4.0.2, with
  Nuxt's devtools off, until devtools ships simple-git 4 (#2 D-4). Third-party versions are pinned
  exactly, and ours by `^0.1.0` (#2 D-17). No high or critical
  advisory is allowed in any scope, and none is ever allowlisted (#2 D-2):
  - Grype scans every installed package, development ones included;
  - dependency review fails on high.

  CI checks each `@reference-systems-lab` tarball against the lockfile and its attestation
  (commerce#3 DE-10).

- **Container** (#1 D8 as changed by #2 D-26; #2 D-11, D-12):
  - `.output` is built once on the build machine, with no network.
  - It's copied onto Chainguard's Node image, `cgr.dev/chainguard/node`, for `linux/amd64` and
    `linux/arm64`. That base has no shell and no known vulnerabilities. Every base is pinned by
    digest.
  - Distroless Node was the spike's choice, but its Debian packages carry high-severity CVEs that
    Debian won't fix, and no high may be allowlisted (#2 D-2).
  - Chainguard's free images publish only `latest`, so the image runs the newest Node, 26 today.
    Node 26 becomes LTS on 2026-10-28, when commerce#3 DE-2 moves to it. The build stage uses the
    same Node.
  - It runs as `65532`, with a read-only root and a small `/tmp`.
  - A Node health-check script replaces a shell.
  - On stop, it drains for up to 10 seconds.
  - The npm token reaches only `npm ci`, as a BuildKit secret.
- **Running on the platform.** `compose.platform.yaml` declares only `storefront-web`.
  - It sets no image, ports, networks or dependencies, and takes the backend's address as a required
    variable.
  - The platform's wiring file pins the image digest and puts the service on `edge`
    (commerce-platform#1 P-D2).
  - The health check and the home page don't depend on the backend.
  - The platform's side, the include, the wiring and the proxy route for `rsl-commerce.test`, is the
    platform's own issue. This repository's part ends at a released, verified v0.1.0 (#2 D-19).
- **Releases.** A GitHub release `vX.Y.Z` on a commit on `main`, published by hand, runs one
  workflow, as the backend's does. In order, it:
  1. stops if the version already exists;
  2. builds the image;
  3. scans it with Grype at high;
  4. pushes both architectures to `ghcr.io/reference-systems-lab/commerce-storefront`, with an SBOM
     and provenance;
  5. attests the image.

  The release job's own token is also the build's npm secret. That token can write packages, which
  is accepted because no install script runs and the build has no network (#2 D-21).

- **Checks** (commerce#3 DE-4):
  - ESLint, Prettier, vue-tsc, Knip, Vitest, hadolint and actionlint;
  - a CI stub that runs the real backend v0.1.0 and Postgres on internal networks, and drives the
    storefront with Playwright;
  - Grype at `high` and dependency review (#2 D-18);
  - CodeQL for JavaScript and TypeScript;
  - Dependabot for npm, Docker, Compose and actions, with a seven-day cooldown. It reads our packages
    with the repository's own token through each package's Actions access, with no personal token
    (#2 D-16);
  - secret scanning and push protection on the repository (#2 D-24);
  - every action pinned by commit SHA.

## Alternatives

- **Astro 7 with Vue islands** has cache tags and ships no JavaScript on marketing pages. But it cuts
  the Vue app context at every island, its server image needs `node_modules`, and it has had three
  majors in 19 months. It would win only if the storefront were mostly content (#1).
- **Hand-rolled Vite SSR** would mean rebuilding payload escaping, head management, routing and
  caching ourselves (#1).
- **Distroless Node with a weaker image scan** was also on the table. Either way the image would ship
  Debian's won't-fix highs:
  - failing only on fixable findings;
  - or a critical-only cutoff for the image.
- **Calling the API through the proxy** is ruled out by the DNS and CA problems above.
- **Browser calls to the API with CORS, or a same-origin backend-for-frontend route**, wait for
  sessions. A route would also add server code the skeleton doesn't need.
- **`strict: true`** drops `'unsafe-inline'` from `style-src`, and adds COEP `require-corp` and HSTS
  preload.
- **Stripping 4.6's speculation-rules script with a Nitro plugin** works against the framework;
  **pinning 4.5.2 for good** only delays the same work, since Dependabot proposes 4.6 at once.
- **Allowlisting the unfixed advisories** (#2 D-3) would break the rule that none is ever allowed;
  the first merge waits instead.
- **A mock API in CI** would be a new technology used only by tests, when the real backend image is
  small.
- **Splitting the release into a read-only build and a write-only push** needs a tool to push an OCI
  layout from another job.

## Consequences

- The storefront can't merge or release while a high or critical advisory sits anywhere in its
  tree. As this is written, braces (GHSA-vfj7-8cjw-p6xm) and node-forge (GHSA-86w9-cpqp-85rv) have
  no fix; both arrive through nitropack, so the first merge waits for them (#2 D-3).
- The public image contains the SDK's built code. The SDK's source is in the public backend
  repository, so nothing is exposed that wasn't already (#2 D-23).
- A page that shows prices must be server-rendered. Product data is shown through Vue's escaping,
  never `v-html`, and the payload through devalue's.
- nuxt-security adds the nonce to every script in the rendered page, so the CSP doesn't stop markup
  injected into it: escaping is the control, and the fragment smoke plants a name holding markup to
  prove it. The CSP still blocks inline event handlers and `javascript:` URLs (`script-src-attr
'none'`).
- Each Nuxt release needs the CSP checks again. CI runs them in three browser engines.
- Applications talk over plain HTTP on `edge`. It's internal and holds only services the platform
  defines; internal TLS is a later platform decision.
- The first push to GHCR creates a private package. It must be made public once, so the platform can
  pull it anonymously, and that can't be undone.
- The platform runs whatever digest its wiring file pins, so a release does nothing until the
  platform bumps that pin.
- Nuxt 5 and Nitro 3 are expected in Q4 2026. `compatibilityVersion: 5` keeps that migration small.
- The runtime's Node major moves with Chainguard's `latest`. Dependabot proposes each new digest, and
  CI runs every check against it before it merges.
