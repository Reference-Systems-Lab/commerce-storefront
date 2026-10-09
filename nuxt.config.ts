// The storefront's Nuxt configuration. The reasons are in docs/adr/0001-storefront-stack.md and
// commerce-storefront#2's decisions (D-n below).
export default defineNuxtConfig({
  compatibilityDate: "2026-10-09",
  future: { compatibilityVersion: 5 },
  devtools: { enabled: false },
  telemetry: false,
  modules: ["nuxt-security"],

  app: { head: { htmlAttrs: { lang: "en" } } },
  // Tokens first, so every other stylesheet can use them. The home page's rules live in app.css,
  // because Nuxt inlines a noScripts page's own CSS as <style> (D-7).
  css: ["@reference-systems-lab/tokens/tokens.css", "~/assets/css/app.css"],
  // Stylesheets as <link> tags, which SRI covers.
  features: { inlineStyles: false },
  build: { transpile: [/^@reference-systems-lab\//] },

  // Private: only the server reads it, from NUXT_API_BASE_URL (D-6).
  runtimeConfig: { apiBaseUrl: "" },

  routeRules: {
    // No prices, no scripts: built once (D-7).
    "/": { prerender: true, noScripts: true },
    // Prices: rendered on every request, never cached (#1 D2).
    "/products": { prerender: false, headers: { "cache-control": "no-store" } },
  },

  nitro: { preset: "node-server", prerender: { crawlLinks: false } },

  typescript: {
    tsConfig: {
      extends: "@reference-systems-lab/tsconfig/vue-app.json",
      // Here rather than only in the preset, so it reaches every project Nuxt generates (D-22).
      compilerOptions: { noFallthroughCasesInSwitch: true },
      // Strict templates reject unknown attributes; data-* attributes are markup, not props.
      vueCompilerOptions: { strictTemplates: true, dataAttributes: ["data-*"] },
    },
  },

  // Every directive is set: arrays replace nuxt-security's defaults, but omitted directives keep
  // theirs (D-8).
  security: {
    strict: false,
    nonce: true,
    sri: true,
    hidePoweredBy: true,
    // Per IP, and every request arrives from the proxy's IP.
    rateLimiter: false,
    // Otherwise it sends Access-Control-Allow-Origin: *.
    corsHandler: false,
    // ESLint's no-console does this job.
    removeLoggers: false,
    allowedMethodsRestricter: { methods: ["GET", "HEAD"] },
    headers: {
      // The proxy owns HSTS.
      strictTransportSecurity: false,
      xFrameOptions: "DENY",
      contentSecurityPolicy: {
        "default-src": ["'none'"],
        "script-src": ["'nonce-{{nonce}}'", "'strict-dynamic'"],
        "script-src-attr": ["'none'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'"],
        "font-src": ["'self'"],
        "connect-src": ["'self'"],
        "object-src": ["'none'"],
        "base-uri": ["'none'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
        "upgrade-insecure-requests": false,
      },
    },
  },
});
