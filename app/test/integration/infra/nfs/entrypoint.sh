#!/bin/sh
set -eu

FIXTURE_ROOT="/srv/zerobyte-integration/fixtures"

install -d -m 0755 "$FIXTURE_ROOT/case-a/docs"
printf 'hello from zerobyte integration\n' >"$FIXTURE_ROOT/case-a/hello.txt"
printf 'fixture documentation\n' >"$FIXTURE_ROOT/case-a/docs/readme.md"
find "$FIXTURE_ROOT" -type d -exec chmod 0755 {} +
find "$FIXTURE_ROOT" -type f -exec chmod 0644 {} +

mkdir -p /run/rpc_pipefs /proc/fs/nfsd
mountpoint -q /proc/fs/nfsd || mount -t nfsd nfsd /proc/fs/nfsd
mountpoint -q /run/rpc_pipefs || mount -t rpc_pipefs rpc_pipefs /run/rpc_pipefs
printf '1\n' >/proc/fs/nfsd/nfsv4gracetime
printf '1\n' >/proc/fs/nfsd/nfsv4leasetime

cat >/etc/exports <<EOF
$FIXTURE_ROOT *(ro,sync,no_subtree_check,insecure,fsid=0)
EOF

rpcbind -w
rpc.mountd --no-udp --foreground &
exportfs -ra
rpc.nfsd -V 4 -V 4.1 8

trap 'exportfs -ua; rpc.nfsd 0' INT TERM
while kill -0 "$(pidof rpc.mountd)" 2>/dev/null; do
	sleep 1
done
