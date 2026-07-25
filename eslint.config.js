import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * PeopleOS lint configuration.
 *
 * Beyond ordinary correctness rules, this file exists to make three
 * architectural boundaries **mechanical** rather than textual. Each was
 * previously enforced only by a sentence in a spec, and the Fable doctrine is
 * explicit that a rule a model can satisfy while defeating its purpose
 * eventually will be.
 *
 *  1. The Relationship Engine is a domain service, not a UI utility
 *     (V1-09 acceptance: "no UI module contains relationship calculations").
 *  2. UI reaches storage through the application layer, never directly.
 *  3. Two rules land here disabled, owned by later packages, so the boundary is
 *     written down before the work that makes it true:
 *       - `window.history.state` confined to the navigation module (V1-R5)
 *       - `datasetRevision` arithmetic confined to one module (V1-R4)
 *     Enabling them is part of those packages' acceptance criteria.
 */

const ENGINE_INTERNALS = {
  // The barrel re-exports pure types and the two entry points; reaching past it
  // into engine internals is what "relationship calculations in the UI" means.
  group: ["**/relationship-engine/engine", "**/relationship-engine/explanations"],
  message:
    "UI modules must not perform relationship calculations (V1-09). Consume a projection "
    + "from src/application/* instead, or import types from relationship-engine."
};

const DIRECT_STORAGE = {
  group: ["**/data/database", "**/data/repositories", "**/data/client"],
  message:
    "UI modules must reach storage through src/application/*, not the data layer directly."
};

export default tseslint.config(
  {
    ignores: ["dist/**", "dev-dist/**", "node_modules/**", "coverage/**", "*.config.js"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaVersion: 2022, sourceType: "module" }
    },
    rules: {
      "no-console": "error",
      eqeqeq: ["error", "smart"],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      // The codebase uses deliberate `as never` casts at the idb boundary, where
      // the library's generic store types cannot express a dynamic store name.
      "@typescript-eslint/no-explicit-any": "error"
    }
  },

  // Boundary 1 and 2: UI modules.
  //
  // ENGINE_INTERNALS passes cleanly today — V1-09's boundary held — so it is a
  // true gate from this commit. DIRECT_STORAGE has 30 pre-existing violations
  // across 25 screens; each is marked at its exact line with an
  // `eslint-disable-next-line` naming V1-R4 as its owner. That makes the debt
  // visible, countable and impossible to add to silently, without dragging a
  // 25-file refactor into V1-R1.
  {
    files: ["src/**/*.tsx"],
    ignores: ["src/**/*.test.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "no-restricted-imports": ["error", { patterns: [ENGINE_INTERNALS, DIRECT_STORAGE] }],
      // Catches genuinely broken hook usage. `exhaustive-deps` is deliberately
      // NOT enabled here: the codebase carries considered suppressions of it,
      // and auditing them is its own package, not V1-R1's.
      "react-hooks/rules-of-hooks": "error"
    }
  },

  // The application layer is the only place allowed to compose engine calls.
  {
    files: ["src/domain/**/*.ts", "src/integrations/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/application/**", "**/data/**"],
              message:
                "The domain layer must not depend on the application or data layers."
            }
          ]
        }
      ]
    }
  },

  // The performance ratchet reports its evidence to CI output by design.
  {
    files: ["src/performance/**/*.ts"],
    rules: { "no-console": "off" }
  },

  // Tests may reach anywhere; they exist to exercise the boundaries.
  {
    files: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/test/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
      "no-console": "off"
    }
  }

  // --- Owned by later packages; enable as part of their acceptance criteria ---
  //
  // V1-R5 — one navigation substrate:
  // {
  //   files: ["src/**/*.ts", "src/**/*.tsx"],
  //   ignores: ["src/navigationIntent.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
  //   rules: {
  //     "no-restricted-properties": ["error", {
  //       object: "history", property: "state",
  //       message: "Use the typed navigation intent (V1-R5), not ad-hoc history.state keys."
  //     }]
  //   }
  // },
  //
  // V1-R4 — one write substrate:
  // {
  //   files: ["src/**/*.ts"],
  //   ignores: ["src/data/writes.ts", "src/**/*.test.ts"],
  //   rules: {
  //     "no-restricted-syntax": ["error", {
  //       selector: "Identifier[name='datasetRevision']",
  //       message: "Dataset revision arithmetic belongs in src/data/writes.ts (V1-R4)."
  //     }]
  //   }
  // },
);
