// The design system's shared config, with the adjustments Nuxt needs (commerce-storefront#2 D-14).
import config from "@reference-systems-lab/eslint-config";

export default [
  {
    ignores: [
      ".nuxt/**",
      ".output/**",
      ".data/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  ...config,
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
  // Nuxt auto-imports composables and components; vue-tsc checks those names instead.
  { files: ["**/*.vue"], rules: { "no-undef": "off" } },
  // Nuxt names pages, layouts and the error page after their files.
  {
    files: ["app/app.vue", "app/error.vue", "app/pages/**/*.vue"],
    rules: { "vue/multi-word-component-names": "off" },
  },
  {
    files: ["**/*.{js,mjs,ts,vue}"],
    rules: { "vue/no-v-html": "error", "no-console": "error" },
  },
];
