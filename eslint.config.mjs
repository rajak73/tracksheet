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
    // Prisma's generated client is machine-written and not ours to lint.
    "src/generated/**",
  ]),

  /* ── The dependency direction, enforced ──────────────────────────────────
   * domain ← server ← app/api ← app. Arrows point at what a layer may import.
   *
   * This is a lint rule rather than a paragraph in a README because it had
   * already been broken before anybody wrote the README: `src/server/analytics`
   * imported the Working Hours rule from `src/app/_lib`, so the backend
   * depended on the frontend to know what an hour was. Nothing warned. A
   * convention that is only written down is a convention that drifts.
   */
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app/*", "@/app/**", "@/server/*", "@/server/**"],
              message:
                "src/domain must not import from app or server. It is the layer both of them read, so a dependency either way makes it unusable from the other side.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/server/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app/*", "@/app/**"],
              message:
                "src/server must not import from src/app. If a rule is needed by both, it belongs in src/domain — see src/domain/README.md.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
