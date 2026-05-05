#!/usr/bin/env bash
# exit on error
set -o errexit

# Install dependencies
pnpm install

# Generate Prisma Client
pnpm exec prisma generate

# Install Playwright Chromium Browser (forced to local directory)
echo "--- Installing Playwright Browser ---"
export PLAYWRIGHT_BROWSERS_PATH=0
npx playwright install chromium

# Verify the executable exists
echo "--- Verifying Playwright Installation ---"
find node_modules/playwright-core -name "chrome-headless-shell" || echo "WARNING: Browser not found in node_modules"
