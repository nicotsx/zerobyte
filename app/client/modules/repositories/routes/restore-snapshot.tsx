import { RestoreForm } from "~/client/components/restore-form";
import type { Repository } from "~/client/lib/types";

type Props = {
	repository: Repository;
	snapshotId: string;
	returnPath: string;
	queryBasePath?: string;
	displayBasePath?: string;
};

export function RestoreSnapshotPage(props: Props) {
	const { returnPath, snapshotId, repository, queryBasePath, displayBasePath } = props;

	return (
		<RestoreForm
			repository={repository}
			snapshotId={snapshotId}
			returnPath={returnPath}
			queryBasePath={queryBasePath}
			displayBasePath={displayBasePath}
		/>
	);
}
