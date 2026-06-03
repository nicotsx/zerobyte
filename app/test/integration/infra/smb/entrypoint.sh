#!/bin/sh
set -eu

SMB_USER="${SMB_USER:-zerobyte-smb}"
SMB_PASSWORD="${SMB_PASSWORD:-zerobyte-smb-password}"
SMB_SHARE="${SMB_SHARE:-zerobyte-integration}"
FIXTURE_ROOT="/srv/zerobyte-integration/fixtures"

adduser -D -H -s /sbin/nologin "$SMB_USER" 2>/dev/null || true

install -d -m 0755 "$FIXTURE_ROOT/case-a/docs"
printf 'hello from zerobyte integration\n' >"$FIXTURE_ROOT/case-a/hello.txt"
printf 'fixture documentation\n' >"$FIXTURE_ROOT/case-a/docs/readme.md"
chown -R "$SMB_USER:$SMB_USER" "$FIXTURE_ROOT"
find "$FIXTURE_ROOT" -type d -exec chmod 0755 {} +
find "$FIXTURE_ROOT" -type f -exec chmod 0644 {} +

printf '%s\n%s\n' "$SMB_PASSWORD" "$SMB_PASSWORD" | smbpasswd -a -s "$SMB_USER" >/dev/null
smbpasswd -e "$SMB_USER" >/dev/null

cat >/etc/samba/smb.conf <<EOF
[global]
	server role = standalone server
	server string = Zerobyte Integration SMB
	map to guest = Never
	log file = /dev/stdout
	max log size = 0
	load printers = no
	printing = bsd
	disable spoolss = yes
	bind interfaces only = yes
	interfaces = lo eth0
	smb ports = 445

[$SMB_SHARE]
	path = $FIXTURE_ROOT
	browseable = yes
	read only = yes
	guest ok = no
	valid users = $SMB_USER
EOF

testparm -s >/dev/null
exec smbd --foreground --no-process-group --debug-stdout
