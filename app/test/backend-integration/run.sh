#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/../../.." && pwd)"
default_config_path="$script_dir/artifacts/192.168.2.41/config.generated.json"
config_path="${1:-$default_config_path}"
image_tag="zerobyte-backend-integration"

if [[ ! -f "$config_path" ]]; then
	if [[ "$config_path" == "$default_config_path" ]]; then
		echo "Generated config not found: $config_path" >&2
		echo "Run the target bootstrap first:" >&2
		echo "  bash app/test/backend-integration/setup-target.sh" >&2
	else
		echo "Config file not found: $config_path" >&2
	fi
	exit 1
fi

if command -v realpath >/dev/null 2>&1; then
	config_path="$(realpath "$config_path")"
else
	config_dir="$(cd "$(dirname "$config_path")" && pwd)"
	config_path="$config_dir/$(basename "$config_path")"
fi

docker build -f "$script_dir/Dockerfile" -t "$image_tag" "$repo_root"
docker run --rm \
	--cap-add SYS_ADMIN \
	--device /dev/fuse:/dev/fuse \
	-e ZEROBYTE_INTEGRATION_CONFIG=/config/config.json \
	-v "$config_path:/config/config.json:ro" \
	"$image_tag"
