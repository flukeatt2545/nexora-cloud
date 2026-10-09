import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Compiled bot output and the dev server's cache are not source.
    "**/dist/**",
    ".vinext/**",
  ]),
  {
    rules: {
      // Pictures here are uploads, product covers and links people paste (often on other sites).
      // vinext's next/image blocks remote addresses that are not listed in production and sends
      // local ones through its resizer, so <img> (or SmartImage) stays the right tool.
      "@next/next/no-img-element": "off",
    },
  },
]);

export default eslintConfig;
