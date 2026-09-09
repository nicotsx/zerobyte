import { randomUUID } from "node:crypto";
import { lstat, open, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { lock } from "proper-lockfile";
import { fileSelector, ItemType } from "inquirer-file-selector";
import { readAgentConfiguration } from "./enrollment";
import { parseConfiguredRoots, resolveConfiguredRootPath } from "./trusted-roots";

export const listFolders = async (configPath: string) => {
	const configuration = await readAgentConfiguration(configPath);

	return parseConfiguredRoots(configuration.roots).map((root) => ({
		descriptor: { id: root.id, label: root.label, canBackup: root.allowBackup },
		configuredPath: resolveConfiguredRootPath(root.path),
	}));
};

export const chooseFolders = async () => {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error("Open a terminal on this machine to choose folders.");
	}

	const selection = await fileSelector({
		message: "Choose folders to share with Zerobyte",
		type: ItemType.Directory,
		filter: (item) => item.isDirectory,
		basePath: process.cwd(),
		multiple: true,
		allowCancel: true,
		pageSize: 12,
	});

	return selection?.map((item) => item.path) ?? [];
};

export const addFolders = async (configPath: string, selectedPaths: string[]) => {
	if (!selectedPaths.length) return [];
	configPath = resolve(configPath);

	if ((await lstat(configPath)).isSymbolicLink()) throw new Error("Agent configuration must not be a symbolic link");
	const release = await lock(configPath, { realpath: false, retries: { retries: 3, minTimeout: 100 } });

	const staged = `${configPath}.${randomUUID()}.tmp`;

	try {
		const configuration = await readAgentConfiguration(configPath);
		const roots = parseConfiguredRoots(configuration.roots);

		const canonicalPaths = new Set(
			await Promise.all(
				roots.map((root) => realpath(resolveConfiguredRootPath(root.path)).catch(() => undefined)),
			),
		);
		const labels = new Set(roots.map((root) => root.label.toLocaleLowerCase()));
		const added: string[] = [];

		for (const selected of selectedPaths) {
			const canonical = await realpath(selected);
			if (!(await stat(canonical)).isDirectory())
				throw new Error(`Selected folder "${selected}" is not a directory`);
			if (canonicalPaths.has(canonical)) continue;

			const baseLabel = (
				basename(canonical)
					.replace(/[\p{Cc}\p{Cf}]/gu, "")
					.trim() || "Root folder"
			).slice(0, 80);

			let label = baseLabel;
			for (let suffix = 2; labels.has(label.toLocaleLowerCase()); suffix++) label = `${baseLabel} (${suffix})`;

			roots.push({ id: randomUUID(), label, path: canonical, allowBackup: true });
			canonicalPaths.add(canonical);

			labels.add(label.toLocaleLowerCase());
			added.push(canonical);
		}

		if (!added.length) return added;

		const rawRoots = JSON.stringify(roots);

		parseConfiguredRoots(rawRoots);
		const file = await open(staged, "wx", 0o600);

		try {
			await file.writeFile(JSON.stringify({ ...configuration, roots: rawRoots }, null, 2));
			await file.sync();
		} finally {
			await file.close();
		}

		await rename(staged, configPath);
		return added;
	} finally {
		await rm(staged, { force: true });
		await release();
	}
};
