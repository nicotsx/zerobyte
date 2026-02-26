import type { Readable } from "node:stream";
import type { ResticSnapshotSummaryDto } from "~/schemas/restic-dto";

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
