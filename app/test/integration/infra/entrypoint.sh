#!/usr/bin/env sh
set -eu

if [ -w /etc/fuse.conf ] && ! grep -q '^user_allow_other$' /etc/fuse.conf; then
	printf '\nuser_allow_other\n' >>/etc/fuse.conf
fi

pnpm exec tsx app/test/integration/src/write-rclone-config.ts
exec pnpm exec vitest run --config app/test/integration/vitest.config.ts
