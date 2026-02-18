import { RestoreForm } from "~/client/components/restore-form";
import type { Repository } from "~/client/lib/types";

type Props = {
	repository: Repository;
	snapshotId: string;
	returnPath: string;
	basePath?: string;
};

export function RestoreSnapshotPage(props: Props) {
	const { returnPath, snapshotId, repository, basePath } = props;

	return <RestoreForm repository={repository} snapshotId={snapshotId} returnPath={returnPath} basePath={basePath} />;
}
