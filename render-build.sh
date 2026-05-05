#!/usr/bin/env bash
# exit on error
set -o errexit

# Install dependencies
pnpm install

# Generate Prisma Client
pnpm exec prisma generate

# Install Playwright Chromium Browser
pnpm exec playwright install chromium
