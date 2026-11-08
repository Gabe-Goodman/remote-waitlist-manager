// Type-aware linting. The type-checked rules see the real type of every
// value, so they also catch `any` that flows in from libraries, not just
// `any` written in our own code.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "playwright-report", "test-results"] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.js"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // The browser's own scripts: plain JavaScript, typed by
    // tsconfig.browser.json instead, so the type-aware rules are off here.
    files: ["browser/**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      sourceType: "script",
      globals: {
        document: "readonly",
        navigator: "readonly",
        location: "readonly",
        window: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        Element: "readonly",
        HTMLInputElement: "readonly",
        HTMLElement: "readonly",
        HTMLDetailsElement: "readonly",
      },
    },
  },
);
