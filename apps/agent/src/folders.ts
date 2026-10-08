import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { toMessage } from "@zerobyte/core/utils";
import { Data, Effect } from "effect";
import { fileSelector, ItemType } from "inquirer-file-selector";
import { readConfiguration, writeConfiguration } from "./config";
import * as fs from "./fs";
import { resolveConfiguredRootPath } from "./trusted-roots";

export class FolderSelectionError extends Data.TaggedError("FolderSelectionError")<{ message: string }> {}
class SelectionCanceled extends Data.TaggedError("SelectionCanceled") {}

export const listFolders = (configPath: string) =>
	Effect.map(readConfiguration(configPath), (configuration) =>
		configuration.roots.map((root) => ({ label: root.label, path: resolveConfiguredRootPath(root.path) })),
	);

export const chooseFolders = Effect.gen(function* () {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return yield* new FolderSelectionError({ message: "Open a terminal on this machine to choose folders." });
	}

	const selection = yield* Effect.tryPromise({
		try: () =>
			fileSelector({
				message: "Choose folders to share with Zerobyte",
				type: ItemType.Directory,
				filter: (item) => item.isDirectory,
				basePath: process.cwd(),
				multiple: true,
				allowCancel: true,
				pageSize: 12,
			}),
		catch: (error) =>
			error instanceof Error && error.name === "ExitPromptError"
				? new SelectionCanceled()
				: new FolderSelectionError({ message: `Could not open the folder picker: ${toMessage(error)}` }),
	}).pipe(Effect.catchTag("SelectionCanceled", () => Effect.succeed(null)));

	return selection?.map((item) => item.path) ?? [];
});

const uniqueLabel = (name: string, taken: ReadonlySet<string>) => {
	const base = (name.replace(/[\p{Cc}\p{Cf}]/gu, "").trim() || "Root folder").slice(0, 80);
	let label = base;

	for (let suffix = 2; taken.has(label.toLocaleLowerCase()); suffix++) label = `${base} (${suffix})`;

	return label;
};

export const addFolders = (configPath: string, selectedPaths: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const configuration = yield* readConfiguration(configPath);
		const roots = [...configuration.roots];

		const sharedPaths = new Set(
			yield* Effect.forEach(roots, (root) =>
				fs.realPath(resolveConfiguredRootPath(root.path)).pipe(Effect.orElseSucceed(() => undefined)),
			),
		);
		const labels = new Set(roots.map((root) => root.label.toLocaleLowerCase()));
		const added: string[] = [];

		for (const selected of selectedPaths) {
			const folder = yield* fs.realPath(selected);

			if (!(yield* fs.isDirectory(folder))) {
				return yield* new FolderSelectionError({ message: `Selected folder "${selected}" is not a directory` });
			}

			if (sharedPaths.has(folder)) continue;

			const label = uniqueLabel(basename(folder), labels);

			roots.push({ id: randomUUID(), label, path: folder, allowBackup: true });
			sharedPaths.add(folder);
			labels.add(label.toLocaleLowerCase());
			added.push(folder);
		}

		if (added.length) yield* writeConfiguration(configPath, { ...configuration, roots });

		return added;
	});
