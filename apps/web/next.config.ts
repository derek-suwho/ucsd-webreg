import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

// Workspace packages' src re-exports use NodeNext-style explicit ".js" specifiers
// (`export * from './family.js'`) pointing at co-located .ts files — required for
// `tsc`/`tsx` (NodeNext resolution). Resolve straight from source: transpile the
// packages and alias the ".js" extension to try ".ts"/".tsx" first.
//
// Turbopack (Next's default bundler since v16) has no equivalent to webpack's
// `resolve.extensionAlias` — this is a confirmed, still-open upstream limitation
// (vercel/next.js#82945), not something fixable from next.config.ts. `dev`/`build`
// scripts below pass `--webpack` to opt back into the webpack bundler, which does
// support it. Running the bare `next build`/`next dev` (no flag) will hit Turbopack's
// "webpack config with no turbopack config" guard and fail fast with a message
// pointing at `--webpack` — intentional, since silencing that guard would let the
// build proceed under Turbopack and fail deeper with a confusing "export not found".
const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  poweredByHeader: false,
  transpilePackages: ["@webreg/planner", "@webreg/catalog", "@webreg/search", "@webreg/db", "@webreg/config"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
