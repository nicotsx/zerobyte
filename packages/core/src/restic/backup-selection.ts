import * as fs from "node:fs/promises";
import * as path from "node:path";
import { hasPathListSeparator } from "../utils/index.js";

type PatternToken =
	| { kind: "star" }
	| { kind: "single" }
	| { kind: "literal"; value: Buffer }
	| { kind: "class"; negated: boolean; ranges: ReadonlyArray<readonly [number, number]> };

const SELECTION_BATCH_SIZE = 128;
const PATTERN_WHITESPACE_REGEX = /[\t\v\f \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u;

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
		tokens.push({ kind: "literal", value: Buffer.from(literal.character) });
		index = literal.nextIndex;
	}

	return tokens;
};

const matchesPattern = (tokens: PatternToken[], name: string) => {
	const bytes = Buffer.from(name);
	let tokenIndex = 0;
	let nameIndex = 0;

	while (tokenIndex < tokens.length) {
		const star = tokens[tokenIndex]?.kind === "star";
		while (tokens[tokenIndex]?.kind === "star") {
			tokenIndex += 1;
		}

		const chunkStart = tokenIndex;
		while (tokenIndex < tokens.length && tokens[tokenIndex]?.kind !== "star") {
			tokenIndex += 1;
		}
		if (star && chunkStart === tokenIndex) {
			return true;
		}

		const matchChunk = (startIndex: number) => {
			let byteIndex = startIndex;
			for (let index = chunkStart; index < tokenIndex; index += 1) {
				if (byteIndex >= bytes.length) {
					return undefined;
				}

				const token = tokens[index]!;
				if (token.kind === "literal") {
					if (!bytes.subarray(byteIndex, byteIndex + token.value.length).equals(token.value)) {
						return undefined;
					}
					byteIndex += token.value.length;
					continue;
				}

				const firstByte = bytes[byteIndex]!;
				const byteLength = firstByte < 0xc0 ? 1 : firstByte < 0xe0 ? 2 : firstByte < 0xf0 ? 3 : 4;
				if (token.kind === "class") {
					const codePoint = bytes.toString("utf8", byteIndex, byteIndex + byteLength).codePointAt(0)!;
					const inRange = token.ranges.some(([low, high]) => low <= codePoint && codePoint <= high);
					if (inRange === token.negated) {
						return undefined;
					}
				}
				byteIndex += byteLength;
			}

			return byteIndex;
		};

		let matchedIndex: number | undefined;
		// Restic's Go matcher retries stars at UTF-8 byte offsets, including inside a character.
		for (let startIndex = nameIndex; startIndex <= bytes.length; startIndex += 1) {
			const endIndex = matchChunk(startIndex);
			if (endIndex !== undefined && (tokenIndex < tokens.length || endIndex === bytes.length)) {
				matchedIndex = endIndex;
				break;
			}
			if (!star) {
				return false;
			}
		}
		if (matchedIndex === undefined) {
			return false;
		}

		nameIndex = matchedIndex;
	}

	return nameIndex === bytes.length;
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

const expandPattern = async (sourcePath: string, relativePattern: string, signal: AbortSignal) => {
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

const normalizeSelectionPath = (entry: string, sourcePath: string, format: "raw" | "text") => {
	if (hasPathListSeparator(entry, format)) {
		throw new Error(`Include ${format === "raw" ? "path" : "pattern"} contains an unsupported path character`);
	}

	let relativePath = path.normalize(entry.replace(/^\/+/, ""));

	if (format === "text") {
		// Go's TrimSpace differs from JavaScript's trimEnd; retain Restic's text-list semantics.
		let end = relativePath.length;

		while (end > 0 && PATTERN_WHITESPACE_REGEX.test(relativePath[end - 1]!)) {
			end -= 1;
		}

		relativePath = relativePath.slice(0, end);
	}

	if (!isInsideRoot(sourcePath, path.resolve(sourcePath, relativePath))) {
		throw new Error("Include path escapes source path");
	}

	return relativePath === "." ? "" : relativePath;
};

export const resolveBackupTargets = async (
	options: {
		includePaths?: string[] | null;
		includePatterns?: string[] | null;
	},
	sourcePath: string,
	containmentRootPath: string,
	signal: AbortSignal,
): Promise<string[]> => {
	const includePaths = (options.includePaths ?? []).map((entry) =>
		path.join(sourcePath, normalizeSelectionPath(entry, sourcePath, "raw")),
	);
	const includePatterns = options.includePatterns ?? [];
	const expandedPatterns: string[] = [];

	for (const pattern of includePatterns) {
		signal.throwIfAborted();
		const negated = pattern.startsWith("!");
		const relativePattern = normalizeSelectionPath(negated ? pattern.slice(1) : pattern, sourcePath, "text");
		if (negated) {
			continue;
		}

		const matches = await expandPattern(sourcePath, relativePattern, signal);
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
	for (let index = 0; index < selectedPaths.length; index += 1) {
		signal.throwIfAborted();
		const selectedPath = selectedPaths[index]!;
		await assertContainedTarget(selectedPath, containmentRootPath, signal);
		const processedPaths = index + 1;
		await yieldAfterBatch(processedPaths, signal);
	}

	return selectedPaths;
};
