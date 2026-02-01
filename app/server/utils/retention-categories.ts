import { format } from "date-fns";
import type { RetentionPolicy } from "../modules/backups/backups.dto";

export type RetentionCategory = "latest" | "hourly" | "daily" | "weekly" | "monthly" | "yearly";

interface SnapshotInfo {
	short_id: string;
	time: number;
}

const RETENTION_RULES = [
	{ prop: "keepHourly", tag: "hourly", fmt: "yyyy-MM-dd-HH" },
	{ prop: "keepDaily", tag: "daily", fmt: "yyyy-MM-dd" },
	{ prop: "keepWeekly", tag: "weekly", fmt: "RRRR-'W'II" },
	{ prop: "keepMonthly", tag: "monthly", fmt: "yyyy-MM" },
	{ prop: "keepYearly", tag: "yearly", fmt: "yyyy" },
] as const;

export const computeRetentionCategories = (snapshots: SnapshotInfo[], policy: RetentionPolicy | null) => {
	const categories = new Map<string, RetentionCategory[]>();

	if (!policy || snapshots.length === 0) return categories;

	const sorted = [...snapshots].sort((a, b) => b.time - a.time);

	const addTag = (id: string, tag: RetentionCategory) => {
		const tags = categories.get(id) ?? [];
		if (!tags.includes(tag)) categories.set(id, [...tags, tag]);
	};

	if (policy.keepLast && policy.keepLast > 0) {
		sorted.slice(0, 1).forEach((s) => addTag(s.short_id, "latest"));
	}

	for (const { prop, tag, fmt } of RETENTION_RULES) {
		const limit = policy[prop];
		if (!limit || limit <= 0) continue;

		const seenBuckets = new Set<string>();
		let count = 0;

		for (const snapshot of sorted) {
			if (count >= limit) break;

			const bucketKey = format(snapshot.time, fmt);
			if (!seenBuckets.has(bucketKey)) {
				seenBuckets.add(bucketKey);
				addTag(snapshot.short_id, tag);
				count++;
			}
		}
	}

	return categories;
};
