import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

// This app's version, built in: the server tells Bops Cloud which app is calling (lib/server/app-version.ts).
const { version } = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string };

const nextConfig: NextConfig = {
  env: { BOPS_APP_VERSION: version },
  // The desktop app is the product; Next's floating dev badge sat on top of the sidebar footer.
  devIndicators: false,
  // Loaded by Node, not bundled: the AgentMail SDK lazily imports optional payment packages
  // (@x402/fetch, mppx) that aren't installed, which the bundler can't resolve.
  serverExternalPackages: ["agentmail"],
  // Private deployments use an authenticated custom server; standalone is for the legacy Mac app.
  output: process.env.BOPS_PRIVATE_RUNTIME === "1" ? undefined : "standalone",
  images: { unoptimized: true },
  experimental: { isrFlushToDisk: false },
  outputFileTracingIncludes: {
    "/*": [
      "./vm/**/*",
      "./node_modules/agentmail/**/*",
      "./node_modules/ws/**/*",
      "./node_modules/@playwright/mcp/**/*",
      "./node_modules/playwright/**/*",
      "./node_modules/playwright-core/**/*",
      "./node_modules/@rrweb/record/dist/record.umd.min.cjs",
    ],
  },
  outputFileTracingExcludes: {
    "/*": [
      "./.data/**", "./.env*", "./app/**", "./assets/**", "./build/**", "./components/**", "./db/**", "./desktop/**", "./dist-desktop/**", "./docs/**", "./edge/**", "./envs/**", "./lib/**", "./orgo/**", "./scripts/**", "./site/**", "./types/**", "./vendor/**", "./.scratch/**",
      "./node_modules/app-builder-lib/**", "./node_modules/sharp/**", "./node_modules/@img/**",
      "./*.md", "./*.ts", "./*.mjs", "./components.json", "./package-lock.json", "./tsconfig.json",
    ],
    "next-server": ["./node_modules/sharp/**", "./node_modules/@img/**"],
  },
};
export default nextConfig;
