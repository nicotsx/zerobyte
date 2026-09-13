export interface FileEntry {
	name: string;
	path: string;
	type: string;
	size?: number;
	modifiedAt?: number;
	mode?: number;
}

export function buildFileEntryMap(files: FileEntry[]): Map<string, FileEntry> {
	const entries = new Map(files.map((file) => [file.path, file]));

	for (const file of files) {
		let path = file.path;
		while (path.lastIndexOf("/") > 0) {
			path = path.slice(0, path.lastIndexOf("/"));
			if (entries.has(path)) break;
			entries.set(path, { path, name: path.slice(path.lastIndexOf("/") + 1), type: "dir" });
		}
	}

	return entries;
}
