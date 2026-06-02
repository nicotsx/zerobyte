#!/usr/bin/env sh
set -eu

if [ -w /etc/fuse.conf ] && ! grep -q '^user_allow_other$' /etc/fuse.conf; then
	printf '\nuser_allow_other\n' >>/etc/fuse.conf
fi

bun app/test/integration/src/write-rclone-config.ts
exec bunx --bun vitest run --config app/test/integration/vitest.config.ts
