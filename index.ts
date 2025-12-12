/**
 * @fileoverview Rsbuild plugin to detect and block forbidden imports in Module Federation builds.
 * 
 * This plugin scans source files for imports that won't work in remote environments
 * (e.g., Next.js-specific imports in a Module Federation remote) and fails the build
 * with actionable error messages.
 * 
 * @author Lux Team
 * @license MIT
 * @see https://github.com/example/rsbuild-plugin-block-imports
 */

import type { RsbuildPlugin } from '@rsbuild/core';
import fs from 'fs';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for a forbidden import pattern.
 */
export interface ForbiddenImport {
  /**
   * The import pattern to match (e.g., 'next/link', 'next-intl').
   * Matches imports that start with this string.
   */
  pattern: string;
  
  /**
   * Suggested alternative to use instead.
   * Displayed in the error output to guide developers.
   */
  alternative: string;
  
  /**
   * Optional message providing more context about why this import is forbidden.
   */
  reason?: string;
}

/**
 * Plugin configuration options.
 */
export interface PluginBlockImportsOptions {
  /**
   * Array of forbidden import configurations.
   * Each entry specifies a pattern to match and its alternative.
   */
  forbiddenImports: ForbiddenImport[];
  
  /**
   * Directories or patterns to exclude from checking.
   * By default, 'node_modules' is always excluded.
   * @default []
   */
  exclude?: (string | RegExp)[];
  
  /**
   * Whether to throw an error and fail the build when forbidden imports are found.
   * Set to false to only show warnings.
   * @default true
   */
  failOnError?: boolean;
  
  /**
   * Custom header text for the error output.
   * @default 'MODULE FEDERATION BUILD ERROR'
   */
  errorHeader?: string;
  
  /**
   * Enable colored terminal output.
   * @default true
   */
  colors?: boolean;
}

/**
 * Internal representation of an import error with location info.
 */
interface ImportError {
  /** The matched import pattern */
  importName: string;
  /** Line number (1-indexed) */
  line: number;
  /** Column number (0-indexed) */
  column: number;
  /** The actual line content */
  lineContent: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * ANSI color codes for terminal output.
 * @internal
 */
const ANSI_COLORS = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
} as const;

/**
 * Default forbidden imports for Next.js projects using Module Federation.
 * These imports rely on Next.js internals and won't work in remote environments.
 */
export const NEXTJS_FORBIDDEN_IMPORTS: ForbiddenImport[] = [
  // Core Next.js modules
  { pattern: 'next/link', alternative: '<a href="..."> or react-router Link' },
  { pattern: 'next/image', alternative: '<img src="..."> with proper sizing' },
  { pattern: 'next/router', alternative: 'window.location or custom navigation' },
  { pattern: 'next/navigation', alternative: 'window.location or custom navigation' },
  { pattern: 'next/head', alternative: 'react-helmet or document.head manipulation' },
  { pattern: 'next/script', alternative: '<script> tag or useEffect for dynamic scripts' },
  { pattern: 'next/dynamic', alternative: 'React.lazy() + Suspense' },
  { pattern: 'next/font', alternative: 'CSS @font-face or Google Fonts link tag' },
  { pattern: 'next/headers', alternative: 'Pass headers as props from host application' },
  { pattern: 'next/cookies', alternative: 'document.cookie or js-cookie library' },
  // Next.js ecosystem packages
  { pattern: 'next-intl', alternative: 'react-intl, i18next, or react-i18next' },
  { pattern: 'next-auth', alternative: 'Pass auth state as props from host application' },
  { pattern: 'next-themes', alternative: 'Custom theme context or CSS variables' },
  { pattern: 'next-seo', alternative: 'react-helmet or manual meta tag management' },
  { pattern: 'next-i18next', alternative: 'i18next + react-i18next' },
];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Creates color functions based on whether colors are enabled.
 * @internal
 */
function createColorizer(enabled: boolean) {
  if (!enabled) {
    return {
      red: (s: string) => s,
      yellow: (s: string) => s,
      cyan: (s: string) => s,
      gray: (s: string) => s,
      bold: (s: string) => s,
    };
  }
  
  return {
    red: (s: string) => `${ANSI_COLORS.red}${s}${ANSI_COLORS.reset}`,
    yellow: (s: string) => `${ANSI_COLORS.yellow}${s}${ANSI_COLORS.reset}`,
    cyan: (s: string) => `${ANSI_COLORS.cyan}${s}${ANSI_COLORS.reset}`,
    gray: (s: string) => `${ANSI_COLORS.gray}${s}${ANSI_COLORS.reset}`,
    bold: (s: string) => `${ANSI_COLORS.bold}${s}${ANSI_COLORS.reset}`,
  };
}

/**
 * Checks if a file path should be excluded from checking.
 * @internal
 */
function shouldExclude(filePath: string, excludePatterns: (string | RegExp)[]): boolean {
  // Always exclude node_modules
  if (filePath.includes('node_modules')) {
    return true;
  }
  
  for (const pattern of excludePatterns) {
    if (typeof pattern === 'string') {
      if (filePath.includes(pattern)) {
        return true;
      }
    } else if (pattern.test(filePath)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Finds the line numbers and content for imports in a source file.
 * 
 * @param filePath - Absolute path to the source file
 * @param imports - Set of import patterns to search for
 * @returns Array of import errors with location information
 * @internal
 */
function findImportLocations(filePath: string, imports: Set<string>): ImportError[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const errors: ImportError[] = [];
    
    lines.forEach((lineContent, index) => {
      imports.forEach(importPattern => {
        // Escape special regex characters in the import pattern
        const escapedPattern = importPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Match various import syntaxes:
        // - import ... from 'pattern'
        // - import ... from "pattern"
        // - require('pattern')
        // - import('pattern')
        const patterns = [
          new RegExp(`from\\s+['"]${escapedPattern}(?:/[^'"]*)?['"]`),
          new RegExp(`require\\s*\\(\\s*['"]${escapedPattern}(?:/[^'"]*)?['"]`),
          new RegExp(`import\\s*\\(\\s*['"]${escapedPattern}(?:/[^'"]*)?['"]`),
        ];
        
        for (const regex of patterns) {
          const match = lineContent.match(regex);
          if (match) {
            errors.push({
              importName: importPattern,
              line: index + 1,
              column: match.index ?? 0,
              lineContent: lineContent.trim(),
            });
            break; // Only report once per line per import
          }
        }
      });
    });
    
    return errors;
  } catch (error) {
    // If we can't read the file, return errors without line info
    console.warn(`[plugin-block-imports] Could not read file: ${filePath}`);
    return Array.from(imports).map(imp => ({
      importName: imp,
      line: 0,
      column: 0,
      lineContent: '',
    }));
  }
}

/**
 * Formats and prints the error report to the console.
 * @internal
 */
function printErrorReport(
  errorMap: Map<string, Set<string>>,
  forbiddenImports: ForbiddenImport[],
  options: Required<PluginBlockImportsOptions>,
  cwd: string
): number {
  const c = createColorizer(options.colors);
  const foundImports = new Set<string>();
  let errorCount = 0;
  
  // Create a lookup map for alternatives
  const alternativesMap = new Map<string, string>();
  for (const { pattern, alternative } of forbiddenImports) {
    alternativesMap.set(pattern, alternative);
  }
  
  // Print header
  console.error('');
  console.error(c.red(c.bold('  ╭─────────────────────────────────────────────────────────────╮')));
  console.error(c.red(c.bold(`  │  ${options.errorHeader.padEnd(59)}│`)));
  console.error(c.red(c.bold('  ╰─────────────────────────────────────────────────────────────╯')));
  console.error('');
  console.error(c.red(c.bold('  ✖ Forbidden imports detected in source files')));
  console.error(c.gray('    These imports will not work in the remote environment.'));
  console.error('');
  
  // Print each error with location
  errorMap.forEach((imports, absolutePath) => {
    const relativePath = absolutePath.replace(cwd, '');
    const importErrors = findImportLocations(absolutePath, imports);
    
    importErrors.forEach(err => {
      foundImports.add(err.importName);
      
      const location = err.line > 0 ? `:${err.line}:${err.column}` : '';
      console.error(c.cyan(`  ${relativePath}${location}`));
      console.error(c.red(`    ✖ Forbidden import: ${c.bold(err.importName)}`));
      
      if (err.lineContent) {
        console.error(c.gray(`    │ ${err.lineContent}`));
      }
      
      console.error('');
      errorCount++;
    });
  });
  
  // Print alternatives for found imports only
  if (foundImports.size > 0) {
    console.error(c.yellow('  Suggested alternatives:'));
    foundImports.forEach(imp => {
      const alternative = alternativesMap.get(imp);
      if (alternative) {
        console.error(c.gray(`    • ${imp} → ${alternative}`));
      }
    });
    console.error('');
  }
  
  // Print summary
  const summary = `${errorCount} error(s) found.${options.failOnError ? ' Build failed.' : ''}`;
  console.error(c.red(c.bold(`  ${summary}`)));
  console.error('');
  
  return errorCount;
}

// ============================================================================
// Plugin
// ============================================================================

/**
 * Creates an Rsbuild plugin that detects and blocks forbidden imports.
 * 
 * This plugin is useful for Module Federation setups where certain imports
 * (like Next.js-specific modules) won't work in remote environments.
 * 
 * **Note:** If a forbidden import is present but not actually used, webpack's
 * tree-shaking algorithm will remove it from the final bundle. However, we still
 * warn to encourage clean code and prevent accidental usage.
 * 
 * @param options - Plugin configuration options
 * @returns Rsbuild plugin instance
 * 
 * @example
 * ```ts
 * // Basic usage with Next.js defaults
 * import { pluginBlockImports, NEXTJS_FORBIDDEN_IMPORTS } from 'rsbuild-plugin-block-imports';
 * 
 * export default defineConfig({
 *   plugins: [
 *     pluginBlockImports({
 *       forbiddenImports: NEXTJS_FORBIDDEN_IMPORTS,
 *     }),
 *   ],
 * });
 * ```
 * 
 * @example
 * ```ts
 * // Custom forbidden imports
 * pluginBlockImports({
 *   forbiddenImports: [
 *     { pattern: 'my-internal-package', alternative: 'Use the public API instead' },
 *   ],
 *   failOnError: false, // Only warn, don't fail
 *   exclude: ['test/', /\.spec\.ts$/],
 * });
 * ```
 */
export function pluginBlockImports(options: PluginBlockImportsOptions): RsbuildPlugin {
  // Validate required options
  if (!options.forbiddenImports || !Array.isArray(options.forbiddenImports)) {
    throw new Error('[plugin-block-imports] forbiddenImports option is required and must be an array');
  }
  
  // Apply defaults
  const resolvedOptions: Required<PluginBlockImportsOptions> = {
    forbiddenImports: options.forbiddenImports,
    exclude: options.exclude ?? [],
    failOnError: options.failOnError ?? true,
    errorHeader: options.errorHeader ?? 'MODULE FEDERATION BUILD ERROR',
    colors: options.colors ?? true,
  };
  
  // Create pattern lookup set for fast matching
  const forbiddenPatterns = new Set(resolvedOptions.forbiddenImports.map(f => f.pattern));
  
  return {
    name: 'plugin-block-imports',
    
    setup(api) {
      api.modifyBundlerChain((chain) => {
        chain.plugin('BlockImportsPlugin').use({
          apply(compiler: any) {
            compiler.hooks.compilation.tap('BlockImportsPlugin', (compilation: any) => {
              compilation.hooks.finishModules.tap('BlockImportsPlugin', (modules: any) => {
                const errorMap = new Map<string, Set<string>>();
                const cwd = process.cwd();
                
                // Scan all modules for forbidden imports
                for (const module of modules) {
                  const resource = module.resource;
                  if (!resource) continue;
                  
                  // Skip excluded paths
                  if (shouldExclude(resource, resolvedOptions.exclude)) continue;
                  
                  // Check module dependencies
                  const dependencies = module.dependencies || [];
                  for (const dep of dependencies) {
                    const request = dep.request || dep.userRequest || '';
                    
                    // Find if this import matches any forbidden pattern
                    for (const pattern of forbiddenPatterns) {
                      if (request.startsWith(pattern)) {
                        if (!errorMap.has(resource)) {
                          errorMap.set(resource, new Set());
                        }
                        errorMap.get(resource)!.add(pattern);
                        break;
                      }
                    }
                  }
                }
                
                // Report errors if any were found
                if (errorMap.size > 0) {
                  const errorCount = printErrorReport(
                    errorMap,
                    resolvedOptions.forbiddenImports,
                    resolvedOptions,
                    cwd
                  );
                  
                  if (resolvedOptions.failOnError && errorCount > 0) {
                    throw new Error(
                      `[plugin-block-imports] ${errorCount} forbidden import(s) detected. ` +
                      'See the error report above for details.'
                    );
                  }
                }
              });
            });
          },
        });
      });
    },
  };
}

// Default export for convenience
export default pluginBlockImports;
