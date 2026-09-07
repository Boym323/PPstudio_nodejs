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
    ".next-e2e/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "src/generated/prisma/**",
  ]),
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'CallExpression[callee.property.name="get"][arguments.0.value=/^x-(forwarded-for|real-ip)$/i]',
          message:
            "Proxy hlavičky čtěte výhradně přes getTrustedClientIp z @/lib/http/trusted-client-ip.",
        },
      ],
    },
  },
  {
    files: ["src/lib/http/trusted-client-ip.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
]);

export default eslintConfig;
