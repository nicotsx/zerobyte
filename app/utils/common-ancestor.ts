export const findCommonAncestor = (paths: string[]): string => {
	if (paths.length === 0) return "/";
	if (paths.length === 1) return paths[0];

	const splitPaths = paths.map((path) => path.split("/").filter(Boolean));
	const minLength = Math.min(...splitPaths.map((parts) => parts.length));

	const commonParts: string[] = [];
	for (let i = 0; i < minLength; i++) {
		const partSet = new Set(splitPaths.map((parts) => parts[i]));
		if (partSet.size === 1) {
			commonParts.push(splitPaths[0][i]);
		} else {
			break;
		}
	}

	return "/" + commonParts.join("/");
};
