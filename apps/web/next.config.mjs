import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const appDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(appDir, '../..');

// File tracing should start at the workspace root so shared packages and the
// hoisted node_modules are picked up. That only holds when the whole monorepo
// is present — when this app is deployed on its own (Vercel with a root
// directory of apps/web) the parent is outside the deployment and pointing at
// it produces a doubled output path, so fall back to the app directory.
const hasWorkspaceRoot =
  !process.env.VERCEL && existsSync(join(repoRoot, 'package.json')) && existsSync(join(repoRoot, 'apps'));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: hasWorkspaceRoot ? repoRoot : appDir,
};
export default nextConfig;
