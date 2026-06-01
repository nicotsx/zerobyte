#!/usr/bin/env sh
set -eu

bun app/test/integration/src/write-rclone-config.ts
exec bunx --bun vitest run --config app/test/integration/vitest.config.ts
