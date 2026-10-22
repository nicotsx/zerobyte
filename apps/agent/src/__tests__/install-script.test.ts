import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";

const temporary: string[] = [];

const installer = fileURLToPath(new URL("../../../docs/public/install.sh", import.meta.url));
const harness = `
uname() { case "$1" in -s) printf 'Linux\\n' ;; -m) printf 'x86_64\\n' ;; esac; }
mktemp() { printf '%s\\n' "$TEST_DOWNLOAD_DIR"; }
curl() {
  local output
  while (( $# )); do
    if [[ "$1" == --output ]]; then output=$2; shift; fi
    shift
  done
  case "$output" in
    *.sha256) printf '%064d  zerobyte-agent-linux-x64\\n' 0 > "$output" ;;
    *) printf '#!/bin/bash\\n/usr/bin/env > %q\\nexit %q\\n' "$TEST_ENV_LOG" "$TEST_INSTALL_EXIT" > "$output" ;;
  esac
}
sha256sum() { printf '%064d  %s\\n' 0 "$1"; }
env() {
  printf '%s\\n' "$@" > "$TEST_INSTALL_LOG"
  command env "$@"
}
source "$@"
`;

afterEach(async () => {
	await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test.each([
	{ exitStatus: 0, allowInsecureHttp: "true" },
	{ exitStatus: 0, allowInsecureHttp: "false" },
	{ exitStatus: 0, allowInsecureHttp: undefined },
	{ exitStatus: 23, allowInsecureHttp: "true" },
	{ exitStatus: 23, allowInsecureHttp: "false" },
	{ exitStatus: 23, allowInsecureHttp: undefined },
])(
	"shell installer isolates environment with opt-in $allowInsecureHttp and preserves exit status $exitStatus",
	async ({ exitStatus, allowInsecureHttp }) => {
		const directory = await mkdtemp(join(tmpdir(), "zerobyte-installer-"));
		temporary.push(directory);
		const download = join(directory, "download with spaces");
		const log = join(directory, "install-args");
		const environmentLog = join(directory, "install-env");
		await mkdir(download);

		const result = spawnSync("/bin/bash", ["-c", harness, "installer-test", installer, "--code", "test code"], {
			encoding: "utf8",
			env: {
				PATH: "/usr/bin:/bin",
				ZEROBYTE_AGENT_VERSION: "v1.2.3",
				ZEROBYTE_AGENT_ALLOW_INSECURE_HTTP: allowInsecureHttp,
				UNRELATED_INSTALLER_VARIABLE: "must not reach the binary",
				TEST_DOWNLOAD_DIR: download,
				TEST_INSTALL_LOG: log,
				TEST_ENV_LOG: environmentLog,
				TEST_INSTALL_EXIT: String(exitStatus),
			},
			timeout: 10_000,
		});

		expect(result.error).toBeUndefined();
		expect(result.stderr).toBe("");
		expect(result.status).toBe(exitStatus);
		expect(await readFile(log, "utf8")).toBe(
			[
				"-i",
				"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
				"HOME=/var/lib/zerobyte-agent",
				`ZEROBYTE_AGENT_ALLOW_INSECURE_HTTP=${allowInsecureHttp ?? "false"}`,
				join(download, "zerobyte-agent-linux-x64"),
				"install",
				"--code",
				"test code",
				"",
			].join("\n"),
		);

		const environment = (await readFile(environmentLog, "utf8")).trim().split("\n");

		expect(environment).toContain("PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
		expect(environment).toContain("HOME=/var/lib/zerobyte-agent");
		expect(environment).toContain(`ZEROBYTE_AGENT_ALLOW_INSECURE_HTTP=${allowInsecureHttp ?? "false"}`);
		expect(environment.some((entry) => entry.startsWith("UNRELATED_INSTALLER_VARIABLE="))).toBe(false);
		expect(environment.some((entry) => entry.startsWith("ZEROBYTE_AGENT_VERSION="))).toBe(false);
		expect(environment.some((entry) => entry.startsWith("TEST_"))).toBe(false);

		await expect(stat(download)).rejects.toMatchObject({ code: "ENOENT" });
	},
);
