#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_HOST="192.168.2.41"
TARGET="root@$TARGET_HOST"
FIXTURE_UID="1000"
FIXTURE_GID="1000"

ARTIFACTS_DIR="$SCRIPT_DIR/artifacts/$TARGET_HOST"
KEY_PATH="$ARTIFACTS_DIR/zerobyte-sftp-ed25519"
KNOWN_HOSTS_PATH="$ARTIFACTS_DIR/known_hosts"
CONFIG_PATH="$ARTIFACTS_DIR/config.generated.json"

SMB_PASSWORD_FILE="$ARTIFACTS_DIR/smb-password.txt"
SFTP_PASSWORD_FILE="$ARTIFACTS_DIR/sftp-password.txt"
WEBDAV_PASSWORD_FILE="$ARTIFACTS_DIR/webdav-password.txt"
RESTIC_PASSWORD_FILE="$ARTIFACTS_DIR/restic-password.txt"

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
RESTIC_PASSWORD="$(read_or_create_secret "$RESTIC_PASSWORD_FILE")"

if [[ ! -f "$KEY_PATH" || ! -f "$KEY_PATH.pub" ]]; then
	ssh-keygen -q -t ed25519 -N "" -C "zerobyte-backend-integration@$TARGET_HOST" -f "$KEY_PATH"
	chmod 600 "$KEY_PATH"
fi

PUBLIC_KEY_BASE64="$(base64 <"$KEY_PATH.pub" | tr -d '\n')"

ssh "$TARGET" bash -s -- "$FIXTURE_UID" "$FIXTURE_GID" "$SMB_PASSWORD" "$SFTP_PASSWORD" "$WEBDAV_PASSWORD" "$RESTIC_PASSWORD" "$PUBLIC_KEY_BASE64" <<'REMOTE'
set -euo pipefail

fixture_uid="$1"
fixture_gid="$2"
smb_password="$3"
sftp_password="$4"
webdav_password="$5"
restic_password="$6"
public_key="$(printf '%s' "$7" | base64 -d)"
repo_path="/srv/zerobyte-backend-integration/restic-repo"
repo_password_fingerprint_path="$repo_path/.zerobyte-password-sha256"
repo_password_fingerprint="$(printf '%s' "$restic_password" | sha256sum | cut -d' ' -f1)"

export DEBIAN_FRONTEND=noninteractive

write_file() {
	local file_path="$1"
	cat >"$file_path"
}

initialize_restic_repo() {
	local password_file

	rm -rf "$repo_path"
	install -d -o zerobyte-sftp -g zerobyte-sftp -m 0700 "$repo_path"

	password_file="$(mktemp)"
	printf '%s\n' "$restic_password" >"$password_file"
	chown zerobyte-sftp:zerobyte-sftp "$password_file"
	chmod 0600 "$password_file"
	su -s /bin/sh -c "restic init --repo '$repo_path' --password-file '$password_file'" zerobyte-sftp
	rm -f "$password_file"

	printf '%s\n' "$repo_password_fingerprint" >"$repo_password_fingerprint_path"
	chmod 0600 "$repo_password_fingerprint_path"
}

apt-get update
apt-get install -y apache2 apache2-utils nfs-kernel-server openssh-server restic rpcbind samba

id -u zerobyte-sftp >/dev/null 2>&1 || useradd --create-home --home-dir /home/zerobyte-sftp --shell /bin/bash zerobyte-sftp
id -u zerobyte-smb >/dev/null 2>&1 || useradd --create-home --home-dir /home/zerobyte-smb --shell /bin/bash zerobyte-smb

install -d -m 0755 /srv/zerobyte-backend-integration/fixtures/case-a/docs
printf 'hello from zerobyte integration\n' >/srv/zerobyte-backend-integration/fixtures/case-a/hello.txt
printf 'fixture documentation\n' >/srv/zerobyte-backend-integration/fixtures/case-a/docs/readme.md
chown -R "$fixture_uid:$fixture_gid" /srv/zerobyte-backend-integration/fixtures
find /srv/zerobyte-backend-integration/fixtures -type d -exec chmod 0755 {} +
find /srv/zerobyte-backend-integration/fixtures -type f -exec chmod 0644 {} +

install -d -o zerobyte-sftp -g zerobyte-sftp -m 0700 /home/zerobyte-sftp
install -d -o zerobyte-sftp -g zerobyte-sftp -m 0700 /home/zerobyte-sftp/.ssh
printf '%s\n' "$public_key" >/home/zerobyte-sftp/.ssh/authorized_keys
chown zerobyte-sftp:zerobyte-sftp /home/zerobyte-sftp/.ssh/authorized_keys
chmod 0600 /home/zerobyte-sftp/.ssh/authorized_keys

printf '%s\n%s\n' "$smb_password" "$smb_password" | smbpasswd -a -s zerobyte-smb >/dev/null
smbpasswd -e zerobyte-smb >/dev/null
printf 'zerobyte-sftp:%s\n' "$sftp_password" | chpasswd
passwd -u zerobyte-sftp >/dev/null 2>&1 || true
htpasswd -bc /etc/apache2/zerobyte-backend-integration.htpasswd zerobyte-webdav "$webdav_password" >/dev/null

if [[ ! -f "$repo_path/config" ]]; then
	initialize_restic_repo
elif [[ ! -f "$repo_password_fingerprint_path" ]] || [[ "$(cat "$repo_password_fingerprint_path")" != "$repo_password_fingerprint" ]]; then
	initialize_restic_repo
fi

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

systemctl restart apache2
systemctl restart smbd
systemctl restart ssh
REMOTE

ssh-keyscan "$TARGET_HOST" >"$KNOWN_HOSTS_PATH" 2>/dev/null

INTEGRATION_HOST="$TARGET_HOST" \
	FIXTURE_UID="$FIXTURE_UID" \
	FIXTURE_GID="$FIXTURE_GID" \
	SMB_PASSWORD="$SMB_PASSWORD" \
	WEBDAV_PASSWORD="$WEBDAV_PASSWORD" \
	RESTIC_PASSWORD="$RESTIC_PASSWORD" \
	SFTP_KEY_PATH="$KEY_PATH" \
	KNOWN_HOSTS_PATH="$KNOWN_HOSTS_PATH" \
	CONFIG_PATH="$CONFIG_PATH" \
	bun run "$SCRIPT_DIR/write-generated-config.ts"

echo "Provisioned $TARGET"
echo "Generated config: $CONFIG_PATH"
echo "Artifacts: $ARTIFACTS_DIR"
