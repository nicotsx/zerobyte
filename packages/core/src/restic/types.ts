import type { Readable } from "node:stream";
import type { ResticSnapshotSummaryDto } from "./restic-dto";

export interface ResticDeps {
	resolveSecret: (encrypted: string) => Promise<string>;
	getOrganizationResticPassword: (organizationId: string) => Promise<string>;
	resticCacheDir: string;
	resticPassFile: string;
	defaultExcludes: string[];
	rcloneConfigFile: string;
	hostname?: string;
}

export interface RetentionPolicy {
	keepLast?: number;
	keepHourly?: number;
	keepDaily?: number;
	keepWeekly?: number;
	keepMonthly?: number;
	keepYearly?: number;
	keepWithinDuration?: string;
}

export type ResticEnv = Record<string, string>;

export interface ResticDumpStream {
	stream: Readable;
	completion: Promise<void>;
	abort: () => void;
}

export type ResticForgetResponse = ForgetGroup[];

export interface ForgetGroup {
	tags: string[] | null;
	host: string;
	paths: string[] | null;
	keep: Snapshot[];
	remove: Snapshot[] | null;
	reasons: ForgetReason[];
}

export interface Snapshot {
	time: string;
	parent?: string;
	tree: string;
	paths: string[];
	hostname: string;
	username?: string;
	uid?: number;
	gid?: number;
	excludes?: string[] | null;
	tags?: string[] | null;
	program_version?: string;
	summary?: ResticSnapshotSummaryDto;
	id: string;
	short_id: string;
}

export interface ForgetReason {
	snapshot: Snapshot;
	matches: string[];
}
