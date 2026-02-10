import type { ResticForgetResponse } from "./restic";

export type RetentionCategory = "last" | "hourly" | "daily" | "weekly" | "monthly" | "yearly";

const MATCH_TO_CATEGORY: Record<string, RetentionCategory> = {
	"last snapshot": "last",
	"hourly snapshot": "hourly",
	"daily snapshot": "daily",
	"weekly snapshot": "weekly",
	"monthly snapshot": "monthly",
	"yearly snapshot": "yearly",
	"oldest hourly snapshot": "hourly",
	"oldest daily snapshot": "daily",
	"oldest weekly snapshot": "weekly",
	"oldest monthly snapshot": "monthly",
	"oldest yearly snapshot": "yearly",
};

export const parseRetentionCategories = (dryRunResults: ResticForgetResponse) => {
	const categories = new Map<string, RetentionCategory[]>();

	for (const group of dryRunResults) {
		for (const reason of group.reasons) {
			const { short_id } = reason.snapshot;
			const categoryList: RetentionCategory[] = [];

			for (const match of reason.matches) {
				const category = MATCH_TO_CATEGORY[match];
				if (category && !categoryList.includes(category)) {
					categoryList.push(category);
				}
			}

			if (categoryList.length > 0) {
				categories.set(short_id, categoryList);
			}
		}
	}

	return categories;
};
