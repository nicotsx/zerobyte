#!/bin/sh
set -eu

WEBDAV_USER="${WEBDAV_USER:-zerobyte-webdav}"
WEBDAV_PASSWORD="${WEBDAV_PASSWORD:-zerobyte-webdav-password}"
SERVICE_ROOT="/srv/zerobyte-integration"
FIXTURE_ROOT="$SERVICE_ROOT/fixtures"
LOCK_ROOT="/var/lib/zerobyte-webdav"

install -d -m 0755 "$FIXTURE_ROOT/case-a/docs"
printf 'hello from zerobyte integration\n' >"$FIXTURE_ROOT/case-a/hello.txt"
printf 'fixture documentation\n' >"$FIXTURE_ROOT/case-a/docs/readme.md"
chown -R apache:apache "$SERVICE_ROOT"

install -d -o apache -g apache -m 0755 "$LOCK_ROOT"
htpasswd -bc /etc/apache2/zerobyte-webdav.htpasswd "$WEBDAV_USER" "$WEBDAV_PASSWORD" >/dev/null

cat >/etc/apache2/conf.d/zerobyte-webdav.conf <<EOF
ServerName localhost
ErrorLog /proc/self/fd/2
CustomLog /proc/self/fd/1 combined

DAVLockDB $LOCK_ROOT/lockdb
Alias /zerobyte-integration $FIXTURE_ROOT

<Location /zerobyte-integration>
	DAV On
	AuthType Basic
	AuthName "Zerobyte Integration WebDAV"
	AuthUserFile /etc/apache2/zerobyte-webdav.htpasswd
	Require valid-user
</Location>

<Directory $FIXTURE_ROOT>
	Options Indexes FollowSymLinks
	AllowOverride None
	Require all granted
</Directory>
EOF

httpd -t
exec httpd -D FOREGROUND
