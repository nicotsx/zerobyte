import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { open, rm, type FileHandle } from "node:fs/promises";
import { promisify } from "node:util";
import { Effect, Exit, Stream } from "effect";
import { gt } from "semver";
import {
	AGENT_RELEASE_EXECUTABLES,
	agentReleaseAssetUrl,
	type AgentReleaseManifest,
} from "@zerobyte/contracts/agent-release";
import { downloadAgentRelease, streamAgentReleaseAsset } from "@zerobyte/contracts/agent-release-download";
import { updateIO, UpdateIOError } from "./update-io";

const exec = promisify(execFile);
const MAX_BINARY_BYTES = 256 * 1024 * 1024;

export const matchesUpdateTarget = (a: AgentReleaseManifest, b: AgentReleaseManifest) =>
	a.formatVersion === b.formatVersion &&
	a.tag === b.tag &&
	a.protocolVersion === b.protocolVersion &&
	a.sha256.x64 === b.sha256.x64 &&
	a.sha256.arm64 === b.sha256.arm64;

const writeChunk = (file: FileHandle, chunk: Uint8Array) =>
	updateIO("Could not write staged agent", async () => {
		let offset = 0;
		while (offset < chunk.length) {
			const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset);
			if (!bytesWritten) throw new Error("Empty write");
			offset += bytesWritten;
		}
	}).pipe(Effect.uninterruptible);

const stageBinary = (verified: AgentReleaseManifest, arch: keyof typeof AGENT_RELEASE_EXECUTABLES, staged: string) =>
	Effect.acquireUseRelease(
		updateIO("Could not open staging file", () => open(staged, "wx", 0o600)),
		(file) =>
			Effect.gen(function* () {
				const url = agentReleaseAssetUrl(verified.tag, AGENT_RELEASE_EXECUTABLES[arch]);
				const hash = createHash("sha256");

				yield* streamAgentReleaseAsset(url, MAX_BINARY_BYTES).pipe(
					Stream.runForEach((chunk) =>
						writeChunk(file, chunk).pipe(Effect.tap(() => Effect.sync(() => hash.update(chunk)))),
					),
				);

				if (hash.digest("hex") !== verified.sha256[arch]) {
					return yield* new UpdateIOError({ message: "Agent executable checksum mismatch" });
				}

				yield* updateIO("Could not prepare staged agent for execution", async () => {
					await file.chmod(0o755);
					await file.sync();
				}).pipe(Effect.uninterruptible);
			}),
		(file) => updateIO("Could not close staging file", () => file.close()),
	).pipe(Effect.timeout("5 minutes"));

export const stageUpdate = (
	target: AgentReleaseManifest,
	currentVersion: string,
	arch: keyof typeof AGENT_RELEASE_EXECUTABLES,
	staged: string,
) =>
	Effect.gen(function* () {
		if (!gt(target.tag, currentVersion))
			return yield* new UpdateIOError({ message: "Agent update must be strictly newer" });

		const verified = yield* downloadAgentRelease(target.tag);
		if (!matchesUpdateTarget(verified, target)) {
			return yield* new UpdateIOError({ message: "Signed release does not match the requested release" });
		}

		const removeStagingFile = updateIO("Could not remove staging file", () => rm(staged, { force: true }));
		yield* removeStagingFile.pipe(Effect.uninterruptible);

		yield* Effect.gen(function* () {
			yield* stageBinary(verified, arch, staged);

			const { stdout } = yield* updateIO("Could not identify staged agent build", (signal) =>
				exec(staged, ["update-build"], {
					env: { PATH: "/usr/bin:/bin" },
					signal,
					timeout: 10_000,
					killSignal: "SIGKILL",
					maxBuffer: 4096,
				}),
			);
			if (stdout.trim() !== `${verified.tag} ${verified.protocolVersion}`) {
				return yield* new UpdateIOError({ message: "Staged agent build does not match the signed release" });
			}
		}).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? Effect.ignore(removeStagingFile) : Effect.void)));
	});
