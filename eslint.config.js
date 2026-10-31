// The design system's shared Nuxt config (design-system#8), plus this repository's test coverage output.
import config from "@reference-systems-lab/eslint-config/nuxt";

export default [
  { ignores: ["coverage/**"] },
  ...config,
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
];
