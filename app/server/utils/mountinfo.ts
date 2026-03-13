import fs from "node:fs/promises";
import { isPathWithin } from "@zerobyte/core/utils";

type MountInfo = {
	mountPoint: string;
	fstype: string;
};

export type StatFs = {
	total: number;
	used: number;
	free: number;
};

function unescapeMount(s: string): string {
	return s.replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

export async function readMountInfo(): Promise<MountInfo[]> {
	const text = await fs.readFile("/proc/self/mountinfo", "utf-8");
	const result: MountInfo[] = [];

	for (const line of text.split("\n")) {
		if (!line) continue;
		const sep = line.indexOf(" - ");

		if (sep === -1) continue;

		const left = line.slice(0, sep).split(" ");
		const right = line.slice(sep + 3).split(" ");

		// [0]=mount ID, [1]=parent ID, [2]=major:minor, [3]=root, [4]=mount point, [5]=mount options, ...
		const mpRaw = left[4];
		const fstype = right[0];

		if (!mpRaw || !fstype) continue;

		result.push({ mountPoint: unescapeMount(mpRaw), fstype });
	}
	return result;
}

export async function getMountForPath(p: string): Promise<MountInfo | undefined> {
	const mounts = await readMountInfo();

	let best: MountInfo | undefined;
	for (const m of mounts) {
		if (!isPathWithin(m.mountPoint, p)) continue;
		if (!best || m.mountPoint.length > best.mountPoint.length) {
			best = m;
		}
	}
	return best;
}

export async function getStatFs(mountPoint: string) {
	const s = await fs.statfs(mountPoint, { bigint: true });

	const unit = s.bsize > 0n ? s.bsize : 1n;

	const blocks = s.blocks > 0n ? s.blocks : 0n;

	let bfree = s.bfree > 0n ? s.bfree : 0n;
	if (bfree > blocks) bfree = blocks;

	const bavail = s.bavail > 0n ? s.bavail : 0n;

	const totalB = blocks * unit;
	const usedB = (blocks - bfree) * unit;
	const freeB = bavail * unit;

	const MAX = BigInt(Number.MAX_SAFE_INTEGER);
	const toNumber = (x: bigint) => (x > MAX ? Number.MAX_SAFE_INTEGER : Number(x));

	return {
		total: toNumber(totalB),
		used: toNumber(usedB),
		free: toNumber(freeB),
	};
}
