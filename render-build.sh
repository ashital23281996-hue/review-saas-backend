#!/usr/bin/env bash
# exit on error
set -o errexit

# Install dependencies
pnpm install

# Generate Prisma Client
pnpm exec prisma generate

# Install Playwright Chromium Browser (using Render's recommended cache path)
echo "--- Installing Playwright Browser ---"
export PLAYWRIGHT_BROWSERS_PATH=/opt/render/project/.cache/playwright
mkdir -p $PLAYWRIGHT_BROWSERS_PATH
pnpm dlx playwright install chromium

# Verify the executable exists
echo "--- Verifying Playwright Installation ---"
find /opt/render/project/.cache/playwright -name "chrome-headless-shell" || echo "WARNING: Browser not found in cache"
