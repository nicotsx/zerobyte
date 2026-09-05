import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isPathWithin } from "@zerobyte/core/utils";

type MountInfo = {
	mountPoint: string;
	fstype: string;
};

const execFileAsync = promisify(execFile);

const requireParsedMounts = (text: string, mounts: MountInfo[], source: string) => {
	const hasMountOutput = text.trim().length > 0;
	if (hasMountOutput && mounts.length === 0) {
		throw new Error(`Failed to parse non-empty ${source}`);
	}

	return mounts;
};

export const unescapeMount = (value: string) =>
	value.replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));

export const parseProcMountInfo = (text: string): MountInfo[] => {
	const result: MountInfo[] = [];

	for (const line of text.split("\n")) {
		if (!line) continue;
		const sep = line.indexOf(" - ");
		if (sep === -1) continue;

		const left = line.slice(0, sep).split(" ");
		const right = line.slice(sep + 3).split(" ");
		const mpRaw = left[4];
		const fstype = right[0];

		if (!mpRaw || !fstype) continue;
		result.push({ mountPoint: unescapeMount(mpRaw), fstype });
	}

	return requireParsedMounts(text, result, "/proc/self/mountinfo");
};

export const parseMountOutput = (text: string): MountInfo[] => {
	const mounts: MountInfo[] = [];
	for (const line of text.split("\n")) {
		const match = line.match(/^.+ on (.+) \(([^,)]+)/);
		const mountPoint = match?.[1];
		const fstype = match?.[2];
		if (mountPoint && fstype) {
			mounts.push({ mountPoint: unescapeMount(mountPoint), fstype });
		}
	}
	return requireParsedMounts(text, mounts, "mount command output");
};

export const readMountInfo = async (): Promise<MountInfo[]> => {
	try {
		const text = await fs.readFile("/proc/self/mountinfo", "utf-8");
		return parseProcMountInfo(text);
	} catch (error) {
		if (!isNodeJSErrnoException(error) || error.code !== "ENOENT") throw error;
		const { stdout } = await execFileAsync("mount", []);
		return parseMountOutput(stdout);
	}
};

export const getMountForPath = async (targetPath: string): Promise<MountInfo | undefined> => {
	const mounts = await readMountInfo();
	let best: MountInfo | undefined;

	for (const mount of mounts) {
		if (!isPathWithin(mount.mountPoint, targetPath)) continue;
		if (!best || mount.mountPoint.length > best.mountPoint.length) {
			best = mount;
		}
	}

	return best;
};

export const getStatFs = async (mountPoint: string) => {
	const stat = await fs.statfs(mountPoint, { bigint: true });
	const unit = stat.bsize > 0n ? stat.bsize : 1n;
	const blocks = stat.blocks > 0n ? stat.blocks : 0n;
	let bfree = stat.bfree > 0n ? stat.bfree : 0n;
	if (bfree > blocks) bfree = blocks;
	const bavail = stat.bavail > 0n ? stat.bavail : 0n;
	const max = BigInt(Number.MAX_SAFE_INTEGER);
	const toNumber = (value: bigint) => (value > max ? Number.MAX_SAFE_INTEGER : Number(value));

	return {
		total: toNumber(blocks * unit),
		used: toNumber((blocks - bfree) * unit),
		free: toNumber(bavail * unit),
	};
};

export const isNodeJSErrnoException = (error: unknown): error is NodeJS.ErrnoException => {
	return error instanceof Error && "code" in error;
};
