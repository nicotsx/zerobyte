import * as fs from "node:fs/promises";
import * as path from "node:path";

type PatternToken =
	| { kind: "star" }
	| { kind: "single" }
	| { kind: "literal"; value: string }
	| { kind: "class"; negated: boolean; ranges: ReadonlyArray<readonly [number, number]> };

type TrustedBackupSelection = {
	includePaths: string[];
};

const SELECTION_BATCH_SIZE = 128;

const isInsideRoot = (rootPath: string, candidatePath: string) => {
	const relativePath = path.relative(rootPath, candidatePath);
	return (
		relativePath === "" ||
		(!relativePath.startsWith(`..${path.sep}`) && relativePath !== ".." && !path.isAbsolute(relativePath))
	);
};

const readCharacter = (value: string, index: number) => {
	const codePoint = value.codePointAt(index);
	if (codePoint === undefined) {
		throw new Error("Invalid include pattern");
	}

	const character = String.fromCodePoint(codePoint);
	return { character, nextIndex: index + character.length };
};

const readClassCharacter = (pattern: string, index: number) => {
	if (index >= pattern.length || pattern[index] === "-" || pattern[index] === "]") {
		throw new Error(`Invalid include pattern: ${pattern}`);
	}

	let characterIndex = index;
	if (process.platform !== "win32" && pattern[characterIndex] === "\\") {
		characterIndex += 1;
		if (characterIndex >= pattern.length) {
			throw new Error(`Invalid include pattern: ${pattern}`);
		}
	}

	return readCharacter(pattern, characterIndex);
};

const parsePattern = (pattern: string): PatternToken[] => {
	const tokens: PatternToken[] = [];
	let index = 0;

	while (index < pattern.length) {
		const character = pattern[index];
		if (character === "*") {
			tokens.push({ kind: "star" });
			index += 1;
			continue;
		}
		if (character === "?") {
			tokens.push({ kind: "single" });
			index += 1;
			continue;
		}
		if (character === "[") {
			index += 1;
			const negated = pattern[index] === "^";
			if (negated) {
				index += 1;
			}

			const ranges: Array<readonly [number, number]> = [];
			while (true) {
				if (pattern[index] === "]" && ranges.length > 0) {
					index += 1;
					break;
				}

				const low = readClassCharacter(pattern, index);
				index = low.nextIndex;
				let high = low;
				if (pattern[index] === "-") {
					high = readClassCharacter(pattern, index + 1);
					index = high.nextIndex;
				}

				const lowCodePoint = low.character.codePointAt(0);
				const highCodePoint = high.character.codePointAt(0);
				if (lowCodePoint === undefined || highCodePoint === undefined) {
					throw new Error(`Invalid include pattern: ${pattern}`);
				}
				ranges.push([lowCodePoint, highCodePoint]);
			}

			tokens.push({ kind: "class", negated, ranges });
			continue;
		}
		if (character === "\\" && process.platform !== "win32") {
			index += 1;
			if (index >= pattern.length) {
				throw new Error(`Invalid include pattern: ${pattern}`);
			}
		}

		const literal = readCharacter(pattern, index);
		tokens.push({ kind: "literal", value: literal.character });
		index = literal.nextIndex;
	}

	return tokens;
};

const matchesPattern = (tokens: PatternToken[], name: string) => {
	const characters = Array.from(name);
	const results = new Map<string, boolean>();
	const matchesAt = (tokenIndex: number, characterIndex: number): boolean => {
		const resultKey = `${tokenIndex}:${characterIndex}`;
		const cached = results.get(resultKey);
		if (cached !== undefined) {
			return cached;
		}

		const token = tokens[tokenIndex];
		let matches = false;
		if (token === undefined) {
			matches = characterIndex === characters.length;
		} else if (token.kind === "star") {
			matches =
				matchesAt(tokenIndex + 1, characterIndex) ||
				(characterIndex < characters.length && matchesAt(tokenIndex, characterIndex + 1));
		} else if (characterIndex < characters.length) {
			const value = characters[characterIndex]!;
			if (token.kind === "single") {
				matches = value !== path.sep && matchesAt(tokenIndex + 1, characterIndex + 1);
			} else if (token.kind === "literal") {
				matches = value === token.value && matchesAt(tokenIndex + 1, characterIndex + 1);
			} else {
				const codePoint = value.codePointAt(0);
				const inRange =
					codePoint !== undefined &&
					token.ranges.some(([low, high]) => low <= codePoint && codePoint <= high);
				matches = inRange !== token.negated && matchesAt(tokenIndex + 1, characterIndex + 1);
			}
		}

		results.set(resultKey, matches);
		return matches;
	};

	return matchesAt(0, 0);
};

const hasGoGlobMeta = (pattern: string) => {
	const hasCommonMeta = pattern.includes("*") || pattern.includes("?") || pattern.includes("[");
	return hasCommonMeta || (process.platform !== "win32" && pattern.includes("\\"));
};

const compareNames = (left: string, right: string) => Buffer.compare(Buffer.from(left), Buffer.from(right));

const yieldAfterBatch = async (processedPaths: number, signal: AbortSignal) => {
	if (processedPaths % SELECTION_BATCH_SIZE !== 0) {
		return;
	}

	signal.throwIfAborted();
	await new Promise<void>((resolve) => setImmediate(resolve));
	signal.throwIfAborted();
};

const expandPattern = async (sourcePath: string, patternPath: string, signal: AbortSignal) => {
	if (!isInsideRoot(sourcePath, patternPath)) {
		throw new Error(`Include pattern escapes source path: ${patternPath}`);
	}
	const sourceRelativePattern = path.relative(sourcePath, patternPath);
	const relativePattern = sourceRelativePattern;
	if (relativePattern === "") {
		return [sourcePath];
	}

	const segments = relativePattern.split(path.sep);
	const tokenSets = segments.map((segment) => parsePattern(segment));
	let candidates = [sourcePath];
	let processedPaths = 0;
	for (let index = 0; index < segments.length; index += 1) {
		signal.throwIfAborted();
		const segment = segments[index]!;
		const tokens = tokenSets[index]!;
		const nextCandidates: string[] = [];
		if (!hasGoGlobMeta(segment)) {
			for (const candidate of candidates) {
				signal.throwIfAborted();
				const targetPath = path.join(candidate, segment);
				let targetStats: Awaited<ReturnType<typeof fs.lstat>> | undefined;
				try {
					targetStats = await fs.lstat(targetPath);
				} catch {
					targetStats = undefined;
				}
				if (targetStats) {
					nextCandidates.push(targetPath);
				}
				processedPaths += 1;
				await yieldAfterBatch(processedPaths, signal);
			}
		} else {
			for (const candidate of candidates) {
				signal.throwIfAborted();
				let names: string[];
				try {
					names = await fs.readdir(candidate);
				} catch {
					signal.throwIfAborted();
					continue;
				}

				signal.throwIfAborted();
				names.sort(compareNames);
				for (const name of names) {
					if (matchesPattern(tokens, name)) {
						nextCandidates.push(path.join(candidate, name));
					}
					processedPaths += 1;
					await yieldAfterBatch(processedPaths, signal);
				}
			}
		}
		candidates = nextCandidates;
	}

	return candidates;
};

const isMissingPathError = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";

const resolveExistingAncestor = async (targetPath: string, signal: AbortSignal) => {
	let candidatePath = targetPath;
	while (true) {
		signal.throwIfAborted();
		try {
			const resolvedPath = await fs.realpath(candidatePath);
			signal.throwIfAborted();
			return resolvedPath;
		} catch (error) {
			signal.throwIfAborted();
			if (!isMissingPathError(error)) {
				throw error;
			}

			const parentPath = path.dirname(candidatePath);
			if (parentPath === candidatePath) {
				throw error;
			}
			candidatePath = parentPath;
		}
	}
};

const assertContainedTarget = async (targetPath: string, containmentRootPath: string, signal: AbortSignal) => {
	let resolvedTargetPath: string;
	let targetStats: Awaited<ReturnType<typeof fs.lstat>> | undefined;
	try {
		targetStats = await fs.lstat(targetPath);
	} catch (error) {
		if (!isMissingPathError(error)) {
			throw error;
		}
	}
	signal.throwIfAborted();
	if (targetStats?.isSymbolicLink()) {
		resolvedTargetPath = await resolveExistingAncestor(path.dirname(targetPath), signal);
	} else {
		resolvedTargetPath = await resolveExistingAncestor(targetPath, signal);
	}

	if (!isInsideRoot(containmentRootPath, resolvedTargetPath)) {
		throw new Error("Trusted backup selection escapes its configured root");
	}
};

export const resolveTrustedBackupSelection = async (
	options: {
		includePaths?: string[];
		includePatterns?: string[];
	},
	sourcePath: string,
	containmentRootPath: string,
	signal: AbortSignal,
): Promise<TrustedBackupSelection> => {
	const includePaths = options.includePaths ?? [];
	const includePatterns = options.includePatterns ?? [];
	const expandedPatterns: string[] = [];
	for (const patternPath of includePatterns) {
		signal.throwIfAborted();
		if (patternPath.startsWith("!")) {
			continue;
		}
		const matches = await expandPattern(sourcePath, patternPath, signal);
		for (let index = 0; index < matches.length; index += 1) {
			const matchedPath = matches[index]!;
			expandedPatterns.push(matchedPath);
			const processedPaths = index + 1;
			await yieldAfterBatch(processedPaths, signal);
		}
	}
	signal.throwIfAborted();
	const selectedPaths = [...includePaths, ...expandedPatterns];
	if (includePatterns.length > 0 && selectedPaths.length === 0) {
		throw new Error("No trusted backup target matches the include patterns");
	}
	// ponytail: trusted local writers must not replace validated paths before Restic reads them; use OS confinement to remove this race.
	for (let index = 0; index < selectedPaths.length; index += 1) {
		signal.throwIfAborted();
		const selectedPath = selectedPaths[index]!;
		await assertContainedTarget(selectedPath, containmentRootPath, signal);
		const processedPaths = index + 1;
		await yieldAfterBatch(processedPaths, signal);
	}

	return { includePaths: selectedPaths };
};
