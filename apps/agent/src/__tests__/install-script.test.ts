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
    *)
      if [[ -n "\${TEST_AGENT_SOURCE:-}" ]]; then
        printf '%s\\n' "$TEST_AGENT_SOURCE" > "$output"
      else
        printf '#!/bin/bash\\n/usr/bin/env > %q\\nexit %q\\n' "$TEST_ENV_LOG" "$TEST_INSTALL_EXIT" > "$output"
      fi
      ;;
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

test.skipIf(process.platform !== "linux")(
	"piped installation attaches the terminal for connection-code entry and exits cleanly",
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "zerobyte-installer-prompt-"));
		temporary.push(directory);
		const download = join(directory, "download");
		await mkdir(download);

		const code = "installer-connection-code";
		const modulePath = fileURLToPath(new URL("../connection-code.ts", import.meta.url));
		const agentSource = `#!${process.execPath}
import { promptConnectionCode } from ${JSON.stringify(modulePath)};
if (!process.stdin.isTTY) throw new Error("Installer did not attach terminal input");
const code = await promptConnectionCode();
if (code !== ${JSON.stringify(code)}) throw new Error("Unexpected connection code");
console.log("INSTALL_COMPLETE");
`;
		let output = "";
		let submitted = false;
		const child = Bun.spawn(
			["/bin/bash", "-c", `exec < /dev/null\n${harness}`, "installer-test", installer, "--prompt-code"],
			{
				env: {
					PATH: "/usr/bin:/bin",
					TEST_AGENT_SOURCE: agentSource,
					TEST_DOWNLOAD_DIR: download,
					TEST_INSTALL_LOG: join(directory, "install-args"),
				},
				timeout: 5_000,
				killSignal: "SIGKILL",
				terminal: {
					data(terminal, data) {
						output += Buffer.from(data).toString("utf8");

						if (!submitted && output.includes("? Connection code")) {
							submitted = true;
							terminal.write(`${code}\r`);
						}
					},
				},
			},
		);

		try {
			expect(await child.exited, output).toBe(0);
			expect(submitted).toBe(true);
			expect(output).toContain("INSTALL_COMPLETE");
			expect(output).not.toContain(code);
			await expect(stat(download)).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			child.kill();
			child.terminal?.close();
		}
	},
	10_000,
);

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

		const result = spawnSync(
			"/bin/bash",
			["-c", harness, "installer-test", installer, "--controller", "https://controller.example"],
			{
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
			},
		);

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
				"--controller",
				"https://controller.example",
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
