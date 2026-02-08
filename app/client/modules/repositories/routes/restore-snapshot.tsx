import { RestoreForm } from "~/client/components/restore-form";
import type { Repository, Snapshot } from "~/client/lib/types";

type Props = {
	snapshot: Snapshot;
	repository: Repository;
	snapshotId: string;
	returnPath: string;
};

export function RestoreSnapshotPage(props: Props) {
	const { snapshot, returnPath, snapshotId, repository } = props;

	return <RestoreForm snapshot={snapshot} repository={repository} snapshotId={snapshotId} returnPath={returnPath} />;
}
