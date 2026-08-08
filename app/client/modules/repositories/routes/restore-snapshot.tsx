import { RestoreForm } from "~/client/components/restore-form";
import type { Repository } from "~/client/lib/types";
import type { RestoreTask } from "~/client/modules/repositories/restore-tasks";

type Props = {
	repository: Repository;
	snapshotId: string;
	returnPath: string;
	queryBasePath?: string;
	displayBasePath?: string;
	hasNonPosixSnapshotPaths?: boolean;
	volumeReadOnly?: boolean;
	initialActiveTask?: RestoreTask | null;
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
		initialActiveTask,
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
			initialActiveTask={initialActiveTask}
		/>
	);
}
