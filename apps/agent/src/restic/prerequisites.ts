import { safeExec } from "@zerobyte/core/node";
import { lt } from "semver";
import { getResticCommand } from "./deps";

export const MIN_RESTIC_VERSION = "0.18.0";

export const checkRestic = async () => {
	const command = getResticCommand();
	const result = await safeExec({ command, args: ["version"], timeout: 10_000, maxBuffer: 16_384 });
	if (result.exitCode !== 0) {
		throw new Error(
			`Cannot run Restic (${command}). Install Restic ${MIN_RESTIC_VERSION} or newer on PATH, or set RESTIC_COMMAND to its executable. See https://restic.readthedocs.io/en/stable/020_installation.html`,
		);
	}
	const version = /^restic (\d+\.\d+\.\d+)(?:\s|$)/.exec(result.stdout)?.[1];
	if (!version)
		throw new Error(`Unrecognized Restic version. Install a stable Restic ${MIN_RESTIC_VERSION} or newer.`);
	if (lt(version, MIN_RESTIC_VERSION)) {
		throw new Error(
			`Restic ${version} is too old. Upgrade to Restic ${MIN_RESTIC_VERSION} or newer before starting the agent.`,
		);
	}
	return version;
};
