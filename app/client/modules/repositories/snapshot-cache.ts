import type { QueryClient } from "@tanstack/react-query";
import type { ListSnapshotsResponse } from "~/client/api-client";
import { listSnapshotsQueryKey } from "~/client/api-client/@tanstack/react-query.gen";

export const removeSnapshotsFromListSnapshotsCache = (
	queryClient: QueryClient,
	repositoryId: string,
	snapshotIds: string[],
) => {
	const deletedSnapshotIds = new Set(snapshotIds);
	const listSnapshotsQueryKeyPrefix = listSnapshotsQueryKey({ path: { shortId: repositoryId } });

	queryClient.setQueriesData<ListSnapshotsResponse>({ queryKey: listSnapshotsQueryKeyPrefix }, (snapshots) => {
		if (!snapshots) {
			return snapshots;
		}

		return snapshots.filter((snapshot) => !deletedSnapshotIds.has(snapshot.short_id));
	});
};
