import {
	closeSync,
	fsyncSync,
	linkSync,
	lstatSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { safeExec } from "@zerobyte/core/node";
import { Effect } from "effect";
import { parse } from "semver";
import { updateIO, UpdateIOError } from "./update-io";
import { defaultServicePaths, SERVICE_CONFIG, SERVICE_NAME } from "./service-paths";

// Let systemd restart the main process after the swap is durable and the connection is closed.
export const SYSTEMD_UPDATE_EXIT_CODE = 75;
export const SYSTEMD_UPDATE_ENV = "ZEROBYTE_AGENT_SYSTEMD";
export const SYSTEMD_STARTUP_TIMEOUT_MS = 45_000;
const NOTIFY_TIMEOUT_MS = 10_000;
export const TRIAL_FINALIZATION_RESERVE_MS = NOTIFY_TIMEOUT_MS + 2_000;
export const updateDirectory = (installDir: string) => join(installDir, ".zerobyte-agent-update");

// The previous executable doubles as the marker. A trial left by an interrupted start rolls back on the next boot.
export const systemdRecoveryScript = `#!/bin/sh
set -eu
binary=$1
phase=$2
cd "\${0%/*}"

rollback() {
    /bin/rm -f restore
    if ! [ trial -ef "$binary" ]; then
        /bin/ln trial restore
        /bin/mv -f restore "$binary"
    fi
    /bin/mv -f trial failed
    sync -f .
}

if [ "$phase" = install ]; then
    /bin/rm -f pending trial failed restore staged attempt.json attempt.tmp confirmed.json confirmed.tmp
    sync -f .
    exit
fi

if [ -f trial ]; then
    rollback
fi
if [ "$phase" = start ] && [ -f pending ]; then
    if [ pending -ef "$binary" ]; then
        /bin/mv -f pending failed
    else
        /bin/mv -f pending trial
    fi
    sync -f .
fi
`;

function sameFile(a: string, b: string) {
	const left = statSync(a);
	const right = statSync(b);

	return left.dev === right.dev && left.ino === right.ino;
}

export function currentAgentVersion() {
	const version = process.env.ZEROBYTE_AGENT_VERSION ?? "dev";
	const parsed = parse(version);
	if (!parsed || parsed.prerelease.some((part) => /^(dev|nightly)/i.test(String(part)))) return null;

	const normalized = parsed.build.length ? `${parsed.version}+${parsed.build.join(".")}` : parsed.version;
	return version === normalized || version === `v${normalized}` ? `v${normalized}` : null;
}

function safeSystemPath(path: string, kind: "file" | "directory") {
	const entry = lstatSync(path);
	if (entry.uid !== 0 || (entry.mode & 0o022) !== 0) return false;
	return kind === "file" ? entry.isFile() : entry.isDirectory();
}

export function assertTrustedUpdateDirectory(installDir: string, directory: string) {
	if (resolve(installDir) !== installDir) throw new Error("Expected an absolute agent installation directory");

	for (let parent = installDir; parent !== "/"; parent = dirname(parent)) {
		if (!safeSystemPath(parent, "directory")) throw new Error(`Untrusted agent installation directory: ${parent}`);
	}

	if (!safeSystemPath(directory, "directory")) throw new Error("Untrusted agent update directory");
}

export function detectManagedSystemd(config: string, builtinLocal: boolean) {
	if (process.platform !== "linux" || builtinLocal || process.getuid?.() !== 0) return undefined;
	if (process.env[SYSTEMD_UPDATE_ENV] !== "1" || !process.env.INVOCATION_ID || !process.env.NOTIFY_SOCKET)
		return undefined;

	const binary = join(defaultServicePaths.installDir, "zerobyte-agent");
	const directory = updateDirectory(defaultServicePaths.installDir);
	if (config !== SERVICE_CONFIG || process.execPath !== binary) return undefined;

	const args = process.argv.slice(2);
	if (args.length !== 3 || args[0] !== "run" || args[1] !== "--config" || args[2] !== config) return undefined;

	return { binary, directory };
}

export type ManagedSystemd = NonNullable<ReturnType<typeof detectManagedSystemd>>;

export function isSystemdServiceCgroup(cgroup: string) {
	return cgroup.split("\n").some((line) => {
		const match = /^(?:0:|[1-9]\d*:name=systemd):\/(?:[^/]+\.slice\/)*([^/]+\.service)$/.exec(line);
		return match?.[1] === SERVICE_NAME;
	});
}

export function canUpdateSystemd(service: ManagedSystemd) {
	if (!currentAgentVersion() || (process.arch !== "x64" && process.arch !== "arm64")) {
		return false;
	}

	if (!isSystemdServiceCgroup(readFileSync("/proc/self/cgroup", "utf8"))) return false;

	const { binary, directory } = service;
	assertTrustedUpdateDirectory(dirname(binary), directory);

	return (
		realpathSync(binary) === binary &&
		realpathSync(directory) === directory &&
		safeSystemPath(binary, "file") &&
		(lstatSync(directory).mode & 0o077) === 0 &&
		safeSystemPath(join(directory, "recover"), "file") &&
		sameFile(binary, "/proc/self/exe")
	);
}

export function syncDirectory(path: string) {
	const fd = openSync(path, "r");
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

export const notifySystemdReady = Effect.gen(function* () {
	if (!process.env.NOTIFY_SOCKET) return;

	const result = yield* updateIO("Could not notify systemd that the agent is ready", (signal) =>
		safeExec({
			command: "systemd-notify",
			args: ["--ready"],
			signal,
			timeout: NOTIFY_TIMEOUT_MS,
			killSignal: "SIGKILL",
			maxBuffer: 4096,
		}),
	);
	if (result.exitCode !== 0) {
		return yield* new UpdateIOError({ message: "Could not notify systemd that the agent is ready" });
	}
});

export const acceptSystemdTrial = ({ directory }: ManagedSystemd) =>
	notifySystemdReady.pipe(
		Effect.andThen(
			Effect.try(() => {
				rmSync(join(directory, "trial"));
				syncDirectory(directory);
			}),
		),
	);

export function commitSystemdUpdate({ binary, directory }: ManagedSystemd, staged: string) {
	const pending = join(directory, "pending");
	linkSync(binary, pending);

	let replaced = false;
	try {
		syncDirectory(directory);
		renameSync(staged, binary);
		replaced = true;
		syncDirectory(dirname(binary));
		syncDirectory(directory);
	} catch (error) {
		if (replaced) {
			renameSync(pending, binary);
			syncDirectory(dirname(binary));
		} else {
			rmSync(pending);
		}
		syncDirectory(directory);
		throw error;
	}
}
