#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/../../.." && pwd)"
base_image="zerobyte-integration-runtime-base:latest"
compose_project="zerobyte-integration-$(basename "$repo_root" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')"
artifacts_dir="$script_dir/artifacts"
sftp_artifacts_dir="$artifacts_dir/sftp"
compose_file="$script_dir/infra/docker-compose.yml"
docker_output_log="$artifacts_dir/docker-output.log"
compose=(docker compose -f "$compose_file" -p "$compose_project")

mkdir -p "$artifacts_dir"
if [[ -d "$artifacts_dir/runs" ]]; then
	chmod -R u+rwX "$artifacts_dir/runs" || true
fi
rm -rf "$artifacts_dir/runs"
rm -rf "$sftp_artifacts_dir"
rm -f "$artifacts_dir/compose.log"
rm -f "$docker_output_log"
mkdir -p "$artifacts_dir/runs"
mkdir -p "$sftp_artifacts_dir"

ssh-keygen -q -t ed25519 -N "" -f "$sftp_artifacts_dir/id_ed25519"
chmod 600 "$sftp_artifacts_dir/id_ed25519"
chmod 644 "$sftp_artifacts_dir/id_ed25519.pub"

docker build --progress quiet --target runtime-tools -t "$base_image" "$repo_root" >"$docker_output_log" 2>&1

exit_code=0
"${compose[@]}" up --build --no-color --detach rustfs >>"$docker_output_log" 2>&1 || exit_code=$?

if [[ "$exit_code" -eq 0 ]]; then
	"${compose[@]}" up --build --no-color --abort-on-container-exit --exit-code-from rustfs-setup rustfs-setup >>"$docker_output_log" 2>&1 || exit_code=$?
fi

if [[ "$exit_code" -eq 0 ]]; then
	volume_services=(sftp webdav smb)
	if [[ "${SKIP_VOLUME_MOUNT_INTEGRATION_TESTS:-false}" != "true" ]]; then
		volume_services+=(nfs)
	fi
	"${compose[@]}" up --build --no-color --detach --wait "${volume_services[@]}" >>"$docker_output_log" 2>&1 || exit_code=$?
fi

if [[ "$exit_code" -eq 0 ]]; then
	"${compose[@]}" run --rm --no-deps --build integration 2>>"$docker_output_log" || exit_code=$?
fi

if [[ "$exit_code" -ne 0 ]]; then
	"${compose[@]}" logs --no-color >"$artifacts_dir/compose.log" || true
	echo "Integration Docker logs: $artifacts_dir/compose.log" >&2
	echo "Integration Docker command output: $docker_output_log" >&2
fi

"${compose[@]}" down --volumes --remove-orphans >>"$docker_output_log" 2>&1 || true

exit "$exit_code"
