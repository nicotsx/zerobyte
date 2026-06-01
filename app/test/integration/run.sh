#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/../../.." && pwd)"
base_image="zerobyte-integration-runtime-base:latest"
compose_project="zerobyte-integration-$(basename "$repo_root" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')"
artifacts_dir="$script_dir/artifacts"
compose_file="$script_dir/infra/docker-compose.yml"

mkdir -p "$artifacts_dir"
rm -rf "$artifacts_dir/runs"
rm -f "$artifacts_dir/compose.log"
mkdir -p "$artifacts_dir/runs"

docker build --target production -t "$base_image" "$repo_root"

exit_code=0
docker compose -f "$compose_file" -p "$compose_project" up --build --abort-on-container-exit --exit-code-from rustfs-setup rustfs-setup || exit_code=$?

if [[ "$exit_code" -eq 0 ]]; then
	docker compose -f "$compose_file" -p "$compose_project" up --build --abort-on-container-exit --exit-code-from integration integration || exit_code=$?
fi

if [[ "$exit_code" -ne 0 ]]; then
	docker compose -f "$compose_file" -p "$compose_project" logs --no-color >"$artifacts_dir/compose.log" || true
fi

docker compose -f "$compose_file" -p "$compose_project" down --volumes --remove-orphans || true

exit "$exit_code"
