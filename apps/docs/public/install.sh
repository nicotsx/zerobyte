#!/usr/bin/env bash
# https://zerobyte.app/install.sh — Linux x64/ARM64 with glibc and systemd.
set -euo pipefail

service_path=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

fail() { echo "zerobyte-agent: $*" >&2; exit 1; }

main() (
  local version=${ZEROBYTE_AGENT_VERSION:-latest}
  [[ "$version" == latest || "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9][a-zA-Z0-9.-]*)?$ ]] || fail "Set ZEROBYTE_AGENT_VERSION to latest or a release tag such as v1.0.0"
  [[ "$(uname -s)" == Linux ]] || fail "This installer supports Linux with systemd only"
  local arch
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) fail "Unsupported architecture. Linux x64 and ARM64 are supported" ;;
  esac
  local required
  for required in chmod curl env mktemp sha256sum; do
    command -v "$required" >/dev/null || fail "Install the required command: $required"
  done

  local asset base expected actual binary
  download_dir=$(mktemp -d)
  trap 'rm -rf -- "$download_dir"' EXIT
  asset=zerobyte-agent-linux-$arch
  binary=$download_dir/$asset
  base=https://zerobyte.app/agent/$version
  echo "Downloading $asset ($version)..."
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --connect-timeout 15 --max-time 300 --output "$binary" "$base/$asset"
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --connect-timeout 15 --max-time 60 --output "$download_dir/$asset.sha256" "$base/$asset.sha256"
  read -r expected _ < "$download_dir/$asset.sha256"
  [[ "$expected" =~ ^[a-f0-9]{64}$ ]] || fail "Invalid release checksum"
  actual=$(sha256sum "$binary")
  [[ "${actual%% *}" == "$expected" ]] || fail "Agent checksum mismatch; nothing was installed"
  chmod 755 "$binary"
  env -i PATH="$service_path" HOME=/var/lib/zerobyte-agent "$binary" install "$@"
)

# Defining main before calling it also keeps a truncated piped download from installing anything.
main "$@"
