import { Data, Effect } from "effect";
import { lt } from "semver";
import { Host } from "../host";
import { getResticCommand } from "./deps";

export const MIN_RESTIC_VERSION = "0.18.0";

export class ResticUnavailable extends Data.TaggedError("ResticUnavailable")<{ message: string }> {}

export const checkRestic = Effect.gen(function* () {
	const host = yield* Host;
	const command = getResticCommand();

	const output = yield* host.output(command, ["version"]).pipe(
		Effect.mapError(
			() =>
				new ResticUnavailable({
					message: `Cannot run Restic (${command}). Install Restic ${MIN_RESTIC_VERSION} or newer on PATH, or set RESTIC_COMMAND to its executable. See https://restic.readthedocs.io/en/stable/020_installation.html`,
				}),
		),
	);

	const version = /^restic (\d+\.\d+\.\d+)(?:\s|$)/.exec(output)?.[1];

	if (!version) {
		return yield* new ResticUnavailable({
			message: `Unrecognized Restic version. Install a stable Restic ${MIN_RESTIC_VERSION} or newer.`,
		});
	}

	if (lt(version, MIN_RESTIC_VERSION)) {
		return yield* new ResticUnavailable({
			message: `Restic ${version} is too old. Upgrade to Restic ${MIN_RESTIC_VERSION} or newer before starting the agent.`,
		});
	}

	return version;
});
