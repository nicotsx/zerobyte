#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_HOST="192.168.2.41"
TARGET="root@$TARGET_HOST"
FIXTURE_UID="1000"
FIXTURE_GID="1000"

ARTIFACTS_DIR="$SCRIPT_DIR/artifacts/$TARGET_HOST"
KNOWN_HOSTS_PATH="$ARTIFACTS_DIR/known_hosts"
CONFIG_PATH="$ARTIFACTS_DIR/config.generated.json"

SMB_PASSWORD_FILE="$ARTIFACTS_DIR/smb-password.txt"
SFTP_PASSWORD_FILE="$ARTIFACTS_DIR/sftp-password.txt"
WEBDAV_PASSWORD_FILE="$ARTIFACTS_DIR/webdav-password.txt"

read_or_create_secret() {
	local file_path="$1"

	if [[ -f "$file_path" ]]; then
		cat "$file_path"
	else
		openssl rand -hex 12 >"$file_path"
		chmod 600 "$file_path"
		cat "$file_path"
	fi
}

mkdir -p "$ARTIFACTS_DIR"
chmod 700 "$ARTIFACTS_DIR"

SMB_PASSWORD="$(read_or_create_secret "$SMB_PASSWORD_FILE")"
SFTP_PASSWORD="$(read_or_create_secret "$SFTP_PASSWORD_FILE")"
WEBDAV_PASSWORD="$(read_or_create_secret "$WEBDAV_PASSWORD_FILE")"

ssh "$TARGET" bash -s -- "$FIXTURE_UID" "$FIXTURE_GID" "$SMB_PASSWORD" "$SFTP_PASSWORD" "$WEBDAV_PASSWORD" <<'REMOTE'
set -euo pipefail

fixture_uid="$1"
fixture_gid="$2"
smb_password="$3"
sftp_password="$4"
webdav_password="$5"
legacy_sshd_dir="/etc/ssh/zerobyte-backend-integration-legacy"

export DEBIAN_FRONTEND=noninteractive

write_file() {
	local file_path="$1"
	cat >"$file_path"
}

apt-get update
apt-get install -y apache2 apache2-utils nfs-kernel-server openssh-server rpcbind samba

id -u zerobyte-sftp >/dev/null 2>&1 || useradd --create-home --home-dir /home/zerobyte-sftp --shell /bin/bash zerobyte-sftp
id -u zerobyte-smb >/dev/null 2>&1 || useradd --create-home --home-dir /home/zerobyte-smb --shell /bin/bash zerobyte-smb

install -d -m 0755 /srv/zerobyte-backend-integration/fixtures/case-a/docs
printf 'hello from zerobyte integration\n' >/srv/zerobyte-backend-integration/fixtures/case-a/hello.txt
printf 'fixture documentation\n' >/srv/zerobyte-backend-integration/fixtures/case-a/docs/readme.md
chown -R "$fixture_uid:$fixture_gid" /srv/zerobyte-backend-integration/fixtures
find /srv/zerobyte-backend-integration/fixtures -type d -exec chmod 0755 {} +
find /srv/zerobyte-backend-integration/fixtures -type f -exec chmod 0644 {} +

printf '%s\n%s\n' "$smb_password" "$smb_password" | smbpasswd -a -s zerobyte-smb >/dev/null
smbpasswd -e zerobyte-smb >/dev/null
printf 'zerobyte-sftp:%s\n' "$sftp_password" | chpasswd
passwd -u zerobyte-sftp >/dev/null 2>&1 || true
htpasswd -bc /etc/apache2/zerobyte-backend-integration.htpasswd zerobyte-webdav "$webdav_password" >/dev/null

write_file /etc/exports <<'EOF'
/srv/zerobyte-backend-integration/fixtures *(ro,sync,no_subtree_check,insecure)
EOF
exportfs -ra
systemctl unmask rpcbind rpcbind.socket >/dev/null 2>&1
systemctl start rpcbind.socket
systemctl start rpcbind
systemctl start proc-fs-nfsd.mount
systemctl restart nfs-kernel-server

write_file /etc/samba/smb.conf <<'EOF'
[zerobyte-backend-integration]
	path = /srv/zerobyte-backend-integration/fixtures
	browseable = yes
	read only = yes
	guest ok = no
	valid users = zerobyte-smb
EOF

install -d -o www-data -g www-data -m 0755 /var/lib/dav
a2enmod dav dav_fs auth_basic >/dev/null
printf 'ServerName localhost\n' >/etc/apache2/conf-available/zerobyte-backend-integration-servername.conf
a2enconf zerobyte-backend-integration-servername >/dev/null
write_file /etc/apache2/sites-available/zerobyte-backend-integration-dav.conf <<'EOF'
Alias /zerobyte-backend-integration /srv/zerobyte-backend-integration/fixtures

DAVLockDB /var/lib/dav/lockdb

<Location /zerobyte-backend-integration>
	DAV On
	AuthType Basic
	AuthName "Zerobyte Backend Integration WebDAV"
	AuthUserFile /etc/apache2/zerobyte-backend-integration.htpasswd
	Require valid-user
</Location>

<Directory /srv/zerobyte-backend-integration/fixtures>
	Options Indexes FollowSymLinks
	AllowOverride None
	Require all granted
</Directory>
EOF
a2ensite zerobyte-backend-integration-dav >/dev/null
apache2ctl configtest

install -d -m 0700 "$legacy_sshd_dir"
if [[ ! -f "$legacy_sshd_dir/ssh_host_rsa_key" ]]; then
	ssh-keygen -q -t rsa -b 2048 -N "" -f "$legacy_sshd_dir/ssh_host_rsa_key"
fi

install -d -m 0755 /etc/ssh/sshd_config.d
write_file /etc/ssh/sshd_config.d/zerobyte-backend-integration.conf <<'EOF'
Match User zerobyte-sftp
	PasswordAuthentication yes
	PubkeyAuthentication yes
	PermitTTY no
	X11Forwarding no
	AllowTcpForwarding no
	ForceCommand internal-sftp
EOF
sshd -t

write_file "$legacy_sshd_dir/sshd_config" <<EOF
Port 2222
ListenAddress 0.0.0.0
PidFile /run/zerobyte-backend-integration-legacy-sshd.pid
HostKey $legacy_sshd_dir/ssh_host_rsa_key
HostKeyAlgorithms ssh-rsa
PasswordAuthentication yes
PubkeyAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PermitTTY no
X11Forwarding no
AllowTcpForwarding no
Subsystem sftp internal-sftp

Match User zerobyte-sftp
	ForceCommand internal-sftp
EOF
sshd -t -f "$legacy_sshd_dir/sshd_config"

write_file /etc/systemd/system/zerobyte-backend-integration-legacy-sshd.service <<EOF
[Unit]
Description=Zerobyte Backend Integration Legacy SFTP
After=network.target

[Service]
Type=simple
ExecStart=/usr/sbin/sshd -D -f $legacy_sshd_dir/sshd_config
ExecReload=/bin/kill -HUP \$MAINPID
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now zerobyte-backend-integration-legacy-sshd.service

systemctl restart apache2
systemctl restart smbd
systemctl restart ssh
systemctl restart zerobyte-backend-integration-legacy-sshd.service
systemctl is-active --quiet zerobyte-backend-integration-legacy-sshd.service
for _ in 1 2 3 4 5; do
	ss -ltn | grep -q ':2222' && break
	sleep 1
done
ss -ltn | grep -q ':2222'
REMOTE

ssh-keyscan "$TARGET_HOST" >"$KNOWN_HOSTS_PATH" 2>/dev/null
if ! ssh-keyscan -T 5 -p 2222 "$TARGET_HOST" >>"$KNOWN_HOSTS_PATH" 2>/dev/null; then
	echo "Failed to scan legacy SFTP host key from $TARGET_HOST:2222" >&2
	echo "Check the target service with:" >&2
	echo "  ssh $TARGET systemctl status zerobyte-backend-integration-legacy-sshd.service" >&2
	exit 1
fi

INTEGRATION_HOST="$TARGET_HOST" \
	FIXTURE_UID="$FIXTURE_UID" \
	FIXTURE_GID="$FIXTURE_GID" \
	SMB_PASSWORD="$SMB_PASSWORD" \
	SFTP_PASSWORD="$SFTP_PASSWORD" \
	WEBDAV_PASSWORD="$WEBDAV_PASSWORD" \
	KNOWN_HOSTS_PATH="$KNOWN_HOSTS_PATH" \
	CONFIG_PATH="$CONFIG_PATH" \
	bun run "$SCRIPT_DIR/write-generated-config.ts"

echo "Provisioned $TARGET"
echo "Generated config: $CONFIG_PATH"
echo "Artifacts: $ARTIFACTS_DIR"
