#!/usr/bin/env bash
# exit on error
set -o errexit

# Install dependencies
pnpm install

# Generate Prisma Client
pnpm exec prisma generate

# Install Playwright Chromium Browser (forced to local directory)
export PLAYWRIGHT_BROWSERS_PATH=0
pnpm exec playwright install chromium
