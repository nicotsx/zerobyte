import { RestoreForm } from "~/client/components/restore-form";
import type { Repository, Snapshot } from "~/client/lib/types";

type Props = {
	repository: Repository;
	snapshotId: string;
	returnPath: string;
	queryBasePath?: string;
	displayBasePath?: string;
	hasNonPosixSnapshotPaths?: boolean;
	volumeReadOnly?: boolean;
	snapshot?: Snapshot;
};

export function RestoreSnapshotPage(props: Props) {
	const {
		returnPath,
		snapshotId,
		repository,
		queryBasePath,
		displayBasePath,
		hasNonPosixSnapshotPaths,
		volumeReadOnly,
		snapshot,
	} = props;

	return (
		<RestoreForm
			key={`${repository.shortId}:${snapshotId}`}
			repository={repository}
			snapshotId={snapshotId}
			returnPath={returnPath}
			queryBasePath={queryBasePath}
			displayBasePath={displayBasePath}
			hasNonPosixSnapshotPaths={hasNonPosixSnapshotPaths}
			volumeReadOnly={volumeReadOnly}
			snapshot={snapshot}
		/>
	);
}
