import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { afterEach, expect, test, vi } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import * as resticServer from "@zerobyte/core/restic/server";
import { prepareBackupExecution } from "../backup-execution";
import { createTrustedRootRegistry } from "../trusted-roots";
import { createRunPayload } from "../commands/__tests__/backup-run.harness";

afterEach(() => vi.restoreAllMocks());

test.each([false, true])(
	"backup selections cannot escape the configured root, builtinLocal=%s",
	async (builtinLocal) => {
		const parentPath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-backup-enforcement-"));
		const rootPath = path.join(parentPath, "allowed");
		const outsidePath = path.join(parentPath, "outside");
		fs.mkdirSync(rootPath);
		fs.mkdirSync(outsidePath);
		fs.writeFileSync(path.join(outsidePath, "private.txt"), "outside");
		fs.symlinkSync(outsidePath, path.join(rootPath, "escape"), "dir");

		const registry = createTrustedRootRegistry({
			rawRoots: JSON.stringify([{ id: "data", label: "Data", path: rootPath }]),
			builtinLocal,
		});
		const payload = createRunPayload({
			source: { rootId: "data", relativePath: "" },
		});
		payload.options.includePaths = ["/escape/private.txt"];

		const backup = vi.fn(() => Effect.succeed({ exitCode: 0, result: null, warningDetails: null }));
		vi.spyOn(resticServer, "createRestic").mockReturnValue(fromPartial({ backup }));

		try {
			const execution = await Effect.runPromise(
				prepareBackupExecution(registry, payload, new AbortController().signal, () => {}),
			);

			await expect(Effect.runPromise(execution.runBackup())).rejects.toThrow("Backup failed");
			expect(backup).not.toHaveBeenCalled();
		} finally {
			fs.rmSync(parentPath, { recursive: true, force: true });
		}
	},
);
