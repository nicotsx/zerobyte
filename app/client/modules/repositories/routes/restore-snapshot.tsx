import { RestoreForm } from "~/client/components/restore-form";
import type { Repository, Snapshot } from "~/client/lib/types";

// export const handle = {
// 	breadcrumb: (match: Route.MetaArgs) => [
// 		{ label: "Repositories", href: "/repositories" },
// 		{ label: match.loaderData?.repository.name || match.params.id, href: `/repositories/${match.params.id}` },
// 		{ label: match.params.snapshotId, href: `/repositories/${match.params.id}/${match.params.snapshotId}` },
// 		{ label: "Restore" },
// 	],
// };

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
