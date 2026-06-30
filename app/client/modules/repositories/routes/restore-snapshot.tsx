import { RestoreForm } from "~/client/components/restore-form";
import type { Repository } from "~/client/lib/types";

type SnapshotRestorePlan = { queryBasePath: string; requiresCustomTarget: boolean };

type Props = {
	repository: Repository;
	snapshotId: string;
	returnPath: string;
	snapshotSourcePathPlan: SnapshotRestorePlan;
	displayBasePath?: string;
};

export function RestoreSnapshotPage(props: Props) {
	const { returnPath, snapshotId, repository, snapshotSourcePathPlan, displayBasePath } = props;

	return (
		<RestoreForm
			repository={repository}
			snapshotId={snapshotId}
			returnPath={returnPath}
			snapshotSourcePathPlan={snapshotSourcePathPlan}
			displayBasePath={displayBasePath}
		/>
	);
}
