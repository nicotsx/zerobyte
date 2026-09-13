import { ByteSize } from "~/client/components/bytes-size";
import type { FileEntry } from "~/client/components/file-tree-model";
import { useTimeFormat } from "~/client/lib/datetime";

const GO_MODE_SETUID = 1 << 23;
const GO_MODE_SETGID = 1 << 22;
const GO_MODE_STICKY = 1 << 20;

function formatPermissions(mode: number) {
	const specialPermissions =
		(mode & GO_MODE_SETUID ? 0o4000 : 0) |
		(mode & GO_MODE_SETGID ? 0o2000 : 0) |
		(mode & GO_MODE_STICKY ? 0o1000 : 0);

	return ((mode & 0o777) | specialPermissions).toString(8).padStart(4, "0");
}

export function SnapshotEntryDetails({ entry }: { entry: FileEntry }) {
	const { formatDateTime } = useTimeFormat();

	return (
		<section
			className="shrink-0 border-t bg-muted/30 px-4 py-3"
			aria-label="Selected entry details"
			aria-live="polite"
		>
			<div className="mb-2 truncate text-sm font-medium" title={entry.path}>
				{entry.path}
			</div>
			<dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
				<div>
					<dt className="text-muted-foreground">Type</dt>
					<dd className="mt-0.5 capitalize">{entry.type === "dir" ? "Directory" : entry.type}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">Size</dt>
					<dd className="mt-0.5">
						{entry.size === undefined ? "-" : <ByteSize bytes={entry.size} base={1024} />}
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">Modified</dt>
					<dd className="mt-0.5">
						{entry.modifiedAt === undefined ? "-" : formatDateTime(new Date(entry.modifiedAt))}
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">Permissions</dt>
					<dd className="mt-0.5 font-mono">
						{entry.mode === undefined ? "-" : formatPermissions(entry.mode)}
					</dd>
				</div>
			</dl>
		</section>
	);
}
