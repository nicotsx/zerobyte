import crypto from "node:crypto";
import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { ExpectedEntry } from "./config";

export type SnapshotNode = {
	name: string;
	type: string;
	path: string;
	uid?: number;
	gid?: number;
	mode?: number;
	size?: number;
};

function normalizeRelativePath(input: string): string {
	const normalized = path.posix.normalize(input);
	if (normalized === "") {
		return ".";
	}

	return normalized;
}

function normalizeEntryType(type: string): string {
	if (type === "dir" || type === "directory") {
		return "directory";
	}

	return type;
}

async function readSha256(filePath: string): Promise<string> {
	const digest = crypto.createHash("sha256");
	digest.update(await fs.readFile(filePath));
	return digest.digest("hex");
}

function assertMetadata(
	entryLabel: string,
	expected: ExpectedEntry,
	actual: { uid?: number; gid?: number; mode?: number },
) {
	if (expected.uid && actual.uid !== expected.uid) {
		throw new Error(`${entryLabel} uid mismatch: expected ${expected.uid}, got ${String(actual.uid)}`);
	}

	if (expected.gid && actual.gid !== expected.gid) {
		throw new Error(`${entryLabel} gid mismatch: expected ${expected.gid}, got ${String(actual.gid)}`);
	}

	if (!expected.mode) {
		return;
	}

	if (!actual.mode) {
		throw new Error(`${entryLabel} mode is missing`);
	}

	const permissionBits = actual.mode & 0o7777;
	if (permissionBits !== expected.mode) {
		throw new Error(
			`${entryLabel} mode mismatch: expected ${expected.mode.toString(8)}, got ${permissionBits.toString(8)}`,
		);
	}
}

function getFilesystemEntryType(stats: Stats): ExpectedEntry["type"] {
	if (stats.isDirectory()) {
		return "directory";
	}

	if (stats.isSymbolicLink()) {
		return "symlink";
	}

	return "file";
}

export async function verifyFilesystemEntries(basePath: string, expectedEntries: ExpectedEntry[], label: string) {
	for (const expected of expectedEntries) {
		const targetPath = path.resolve(basePath, expected.path);
		const stats = await fs.lstat(targetPath);

		const actualType = getFilesystemEntryType(stats);
		if (actualType !== expected.type) {
			throw new Error(`${label}: ${expected.path} type mismatch: expected ${expected.type}, got ${actualType}`);
		}

		assertMetadata(`${label}: ${expected.path}`, expected, stats);

		if (expected.type === "file" && expected.text !== undefined) {
			const actualText = await fs.readFile(targetPath, "utf8");
			if (actualText !== expected.text) {
				throw new Error(`${label}: ${expected.path} text content mismatch`);
			}
		}

		if (expected.type === "file" && expected.sha256 !== undefined) {
			const actualSha = await readSha256(targetPath);
			if (actualSha !== expected.sha256.toLowerCase()) {
				throw new Error(`${label}: ${expected.path} sha256 mismatch`);
			}
		}

		if (expected.type !== "symlink" || expected.linkTarget === undefined) {
			continue;
		}

		const actualTarget = await fs.readlink(targetPath);
		if (actualTarget !== expected.linkTarget) {
			throw new Error(
				`${label}: ${expected.path} symlink target mismatch: expected ${expected.linkTarget}, got ${actualTarget}`,
			);
		}
	}
}

export async function verifySnapshotEntries(
	snapshotRootPath: string,
	nodes: SnapshotNode[],
	expectedEntries: ExpectedEntry[],
) {
	const nodesByRelativePath = new Map<string, SnapshotNode>();

	for (const node of nodes) {
		const relativePath = path.posix.relative(snapshotRootPath, node.path);
		if (!relativePath || relativePath === "." || relativePath === ".." || relativePath.startsWith("../")) {
			continue;
		}

		nodesByRelativePath.set(normalizeRelativePath(relativePath), node);
	}

	for (const expected of expectedEntries) {
		const normalizedExpectedPath = normalizeRelativePath(expected.path);
		const node = nodesByRelativePath.get(normalizedExpectedPath);
		if (!node) {
			throw new Error(`snapshot: missing ${expected.path}`);
		}

		const actualType = normalizeEntryType(node.type);
		if (actualType !== expected.type) {
			throw new Error(`snapshot: ${expected.path} type mismatch: expected ${expected.type}, got ${actualType}`);
		}

		assertMetadata(`snapshot: ${expected.path}`, expected, node);
	}
}
