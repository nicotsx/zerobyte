export type ExcludePatternChoice = {
	id: "exact" | "name" | "extension";
	label: string;
	description: string;
	pattern: string;
};

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1) || path;

const extensionOf = (name: string) => {
	const index = name.lastIndexOf(".");
	// A leading dot is a hidden file, not an extension.
	if (index <= 0 || index === name.length - 1) return null;
	return name.slice(index + 1);
};

const identity = (path: string) => path;

/**
 * Exclude patterns offered for one entry, most specific first.
 *
 * The backup executor resolves a pattern starting with `/` relative to the
 * volume, not the host filesystem (see `processPattern` in
 * apps/agent/src/commands/helpers/backup.helpers.ts) — so the exact-path
 * pattern must be volume-relative, even though the tree stores the full host
 * path. `toDisplayPath` does that conversion; without one, entry.path is used
 * as-is, which is only correct when there's no volume to be relative to.
 */
export const buildExcludePatternChoices = (
	entry: { path: string; type: "file" | "dir" },
	toDisplayPath: (path: string) => string = identity,
): ExcludePatternChoice[] => {
	const name = basename(entry.path);

	const choices: ExcludePatternChoice[] = [
		{
			id: "exact",
			label: "This exact path",
			description: "Excludes only this one, wherever it sits in the tree.",
			pattern: toDisplayPath(entry.path),
		},
		{
			id: "name",
			label: `Anything named "${name}"`,
			description: "Excludes every match anywhere under the backup source.",
			pattern: `**/${name}`,
		},
	];

	const extension = entry.type === "file" ? extensionOf(name) : null;
	if (extension) {
		choices.push({
			id: "extension",
			label: `All .${extension} files`,
			description: "Excludes every file with this extension, anywhere.",
			pattern: `*.${extension}`,
		});
	}

	return choices;
};
