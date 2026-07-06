#!/bin/sh
set -eu

SFTP_USER="${SFTP_USER:-zerobyte-sftp}"
SFTP_PASSWORD="${SFTP_PASSWORD:-zerobyte-sftp-password}"
SFTP_PUBLIC_KEY_PATH="${SFTP_PUBLIC_KEY_PATH:-/run/zerobyte/sftp/id_ed25519.pub}"
SFTP_LEGACY_RSA_HOSTKEY="${SFTP_LEGACY_RSA_HOSTKEY:-false}"
SERVICE_ROOT="/srv/zerobyte-integration"

ssh-keygen -A
install -d -m 0755 /run/sshd

if ! id "$SFTP_USER" >/dev/null 2>&1; then
	addgroup -S "$SFTP_USER"
	adduser -S -D -h "/home/$SFTP_USER" -s /bin/sh -G "$SFTP_USER" "$SFTP_USER"
fi

printf '%s:%s\n' "$SFTP_USER" "$SFTP_PASSWORD" | chpasswd

install -d -o "$SFTP_USER" -g "$SFTP_USER" -m 0700 "/home/$SFTP_USER/.ssh"
install -o "$SFTP_USER" -g "$SFTP_USER" -m 0600 "$SFTP_PUBLIC_KEY_PATH" "/home/$SFTP_USER/.ssh/authorized_keys"

install -d -o "$SFTP_USER" -g "$SFTP_USER" -m 0755 "$SERVICE_ROOT/fixtures/case-a/docs"
install -d -o "$SFTP_USER" -g "$SFTP_USER" -m 0755 "$SERVICE_ROOT/fixtures/absolute-symlink-case"
install -d -o "$SFTP_USER" -g "$SFTP_USER" -m 0755 "$SERVICE_ROOT/repos/sftp"
printf 'hello from zerobyte integration\n' >"$SERVICE_ROOT/fixtures/case-a/hello.txt"
printf 'fixture documentation\n' >"$SERVICE_ROOT/fixtures/case-a/docs/readme.md"
ln -s "$SERVICE_ROOT/fixtures/case-a/hello.txt" "$SERVICE_ROOT/fixtures/absolute-symlink-case/absolute-hello-link"
chown -R "$SFTP_USER:$SFTP_USER" "$SERVICE_ROOT"

if [ "$SFTP_LEGACY_RSA_HOSTKEY" = "true" ]; then
cat >/etc/ssh/sshd_config <<EOF
Port 22
HostKey /etc/ssh/ssh_host_rsa_key
HostKeyAlgorithms ssh-rsa
PermitRootLogin no
PasswordAuthentication yes
PubkeyAuthentication no
KbdInteractiveAuthentication no
Subsystem sftp internal-sftp

Match User $SFTP_USER
	ForceCommand internal-sftp
	AllowTcpForwarding no
	X11Forwarding no
	PasswordAuthentication yes
	PubkeyAuthentication no
EOF
else
cat >/etc/ssh/sshd_config <<EOF
Port 22
HostKey /etc/ssh/ssh_host_ed25519_key
HostKey /etc/ssh/ssh_host_rsa_key
PermitRootLogin no
PasswordAuthentication yes
PubkeyAuthentication yes
KbdInteractiveAuthentication no
Subsystem sftp internal-sftp

Match User $SFTP_USER
	ForceCommand internal-sftp
	AllowTcpForwarding no
	X11Forwarding no
	PasswordAuthentication yes
	PubkeyAuthentication yes
EOF
fi

exec /usr/sbin/sshd -D -e
