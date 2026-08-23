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

/**
 * Exclude patterns offered for one entry, most specific first.
 *
 * Restic anchors a pattern that starts with a slash to the absolute path, and
 * the paths in a usage tree are the paths restic itself saw at backup time, so
 * the exact-path pattern needs no translation.
 */
export const buildExcludePatternChoices = (entry: { path: string; type: "file" | "dir" }): ExcludePatternChoice[] => {
	const name = basename(entry.path);

	const choices: ExcludePatternChoice[] = [
		{
			id: "exact",
			label: "This exact path",
			description: "Excludes only this one, wherever it sits in the tree.",
			pattern: entry.path,
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
