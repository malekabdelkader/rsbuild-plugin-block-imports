# rsbuild-plugin-block-imports

> Rsbuild plugin to detect and block forbidden imports in Module Federation builds.


## Why?

When using **Module Federation** to expose React components from a Next.js application, certain imports won't work in remote environments. For example:

- `next/link` - Next.js router integration
- `next/image` - Next.js image optimization
- `next-intl` - Next.js internationalization

This plugin scans your source files during build and **fails fast** with actionable error messages, saving you from runtime errors in production.

## Features

- 🔍 **Detects forbidden imports** with exact file:line:column locations
- 📝 **Shows the actual code** that caused the error
- 💡 **Suggests alternatives** for each forbidden import
- 🎨 **Colored terminal output** for better readability
- ⚙️ **Fully configurable** - add your own patterns
- 🌳 **Tree-shaking aware** - notes that unused imports are safe

## Installation

```bash
npm install rsbuild-plugin-block-imports -D
# or
pnpm add rsbuild-plugin-block-imports -D
# or
yarn add rsbuild-plugin-block-imports -D
```

## Usage

### Basic Usage (Next.js)

```ts
// rsbuild.config.ts
import { defineConfig } from '@rsbuild/core';
import { pluginBlockImports, NEXTJS_FORBIDDEN_IMPORTS } from 'rsbuild-plugin-block-imports';

export default defineConfig({
  plugins: [
    pluginBlockImports({
      forbiddenImports: NEXTJS_FORBIDDEN_IMPORTS,
    }),
  ],
});
```

### Custom Forbidden Imports

```ts
import { pluginBlockImports } from 'rsbuild-plugin-block-imports';

export default defineConfig({
  plugins: [
    pluginBlockImports({
      forbiddenImports: [
        { 
          pattern: 'my-internal-package', 
          alternative: 'Use the public API instead' 
        },
        { 
          pattern: '@company/server-only', 
          alternative: 'This package is server-side only' 
        },
      ],
    }),
  ],
});
```

### Combining with Defaults

```ts
import { pluginBlockImports, NEXTJS_FORBIDDEN_IMPORTS } from 'rsbuild-plugin-block-imports';

export default defineConfig({
  plugins: [
    pluginBlockImports({
      forbiddenImports: [
        ...NEXTJS_FORBIDDEN_IMPORTS,
        { pattern: 'my-custom-import', alternative: 'Use X instead' },
      ],
    }),
  ],
});
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `forbiddenImports` | `ForbiddenImport[]` | **required** | Array of forbidden import patterns |
| `exclude` | `(string \| RegExp)[]` | `[]` | Paths to exclude from checking |
| `failOnError` | `boolean` | `true` | Whether to fail the build on errors |
| `errorHeader` | `string` | `'MODULE FEDERATION BUILD ERROR'` | Custom header for error output |
| `colors` | `boolean` | `true` | Enable colored terminal output |

### ForbiddenImport Interface

```ts
interface ForbiddenImport {
  /** Import pattern to match (e.g., 'next/link') */
  pattern: string;
  /** Suggested alternative */
  alternative: string;
  /** Optional reason why this import is forbidden */
  reason?: string;
}
```

## Example Output

```
  ╭─────────────────────────────────────────────────────────────╮
  │  MODULE FEDERATION BUILD ERROR                              │
  ╰─────────────────────────────────────────────────────────────╯

  ✖ Forbidden imports detected in source files
    These imports will not work in the remote environment.

  /src/components/MyComponent.tsx:5:0
    ✖ Forbidden import: next/image
    │ import Image from 'next/image';

  /src/components/MyComponent.tsx:6:0
    ✖ Forbidden import: next-intl
    │ import { useTranslations } from 'next-intl';

  Suggested alternatives:
    • next/image → <img src="..."> with proper sizing
    • next-intl → react-intl, i18next, or react-i18next

  2 error(s) found. Build failed.
```

## Default Next.js Forbidden Imports

The `NEXTJS_FORBIDDEN_IMPORTS` export includes:

| Import | Alternative |
|--------|-------------|
| `next/link` | `<a href="...">` or react-router Link |
| `next/image` | `<img src="...">` with proper sizing |
| `next/router` | `window.location` or custom navigation |
| `next/navigation` | `window.location` or custom navigation |
| `next/head` | react-helmet or document.head |
| `next/script` | `<script>` tag or useEffect |
| `next/dynamic` | React.lazy() + Suspense |
| `next/font` | CSS @font-face or Google Fonts |
| `next/headers` | Pass headers as props |
| `next/cookies` | document.cookie or js-cookie |
| `next-intl` | react-intl or i18next |
| `next-auth` | Pass auth state as props |
| `next-themes` | Custom theme context |
| `next-seo` | react-helmet |
| `next-i18next` | i18next + react-i18next |

## Tree Shaking Note

If a forbidden import is present in a file but **not actually used** in the exposed components, webpack's tree-shaking algorithm will remove it from the final bundle. This means it won't cause runtime errors.

However, we still report these imports to:
- Encourage clean code
- Prevent accidental future usage
- Make dependencies explicit

To disable build failures and only show warnings, set `failOnError: false`.

## License

MIT

