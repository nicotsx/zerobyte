import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { BackendConfig, Volume } from "@zerobyte/contracts/volumes";
import { toMessage } from "@zerobyte/core/utils";
import { Data, Effect } from "effect";
import { createVolumeBackend } from ".";

class TempDirError extends Data.TaggedError("TempDirError")<{
	cause: unknown;
}> {}

class CleanupError extends Data.TaggedError("CleanupError")<{
	cause: unknown;
	tempDir: string;
}> {}

class MountError extends Data.TaggedError("MountError")<{
	cause: unknown;
}> {}

const createTempDir = Effect.acquireRelease(
	Effect.tryPromise({
		try: () => fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-test-")),
		catch: (error) => new TempDirError({ cause: error }),
	}),
	(tempDir) =>
		Effect.tryPromise({
			try: () => fs.rm(tempDir, { recursive: true, force: true }),
			catch: (error) => new CleanupError({ cause: error, tempDir }),
		}).pipe(Effect.orDie),
);

export const testVolumeConnection = (backendConfig: BackendConfig) =>
	Effect.scoped(
		Effect.gen(function* () {
			const tempDir = yield* createTempDir;

			const mockVolume: Volume = {
				id: 0,
				shortId: "test",
				name: "test-connection",
				config: backendConfig,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				lastHealthCheck: Date.now(),
				type: backendConfig.backend,
				status: "unmounted",
				lastError: null,
				provisioningId: null,
				autoRemount: true,
				agentId: "local",
				organizationId: "test-org",
			};

			const backend = createVolumeBackend(mockVolume, tempDir);

			const mountResult = yield* Effect.tryPromise({
				try: () => backend.mount(),
				catch: (error) => new MountError({ cause: error }),
			});

			yield* Effect.tryPromise({
				try: () => backend.unmount(),
				catch: () => undefined,
			});

			return {
				success: !mountResult.error,
				message: mountResult.error ? toMessage(mountResult.error) : "Connection successful",
			};
		}),
	);
