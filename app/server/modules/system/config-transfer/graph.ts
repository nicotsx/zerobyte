import type { ConfigTransferModel } from "./model";

const assertUniqueRefs = (items: ReadonlyArray<{ ref: string }>, label: string) => {
	const refs = new Set<string>();

	for (const item of items) {
		if (refs.has(item.ref)) {
			throw new Error(`Duplicate ${label} reference: ${item.ref}`);
		}

		refs.add(item.ref);
	}

	return refs;
};

const assertReferenceExists = (refs: Set<string>, ref: string, label: string) => {
	if (!refs.has(ref)) {
		throw new Error(`Unknown ${label} reference: ${ref}`);
	}
};

const assertUniqueAssignments = (assignments: ReadonlyArray<readonly [string, string]>, label: string) => {
	const keys = new Set<string>();

	for (const [sourceRef, targetRef] of assignments) {
		const key = JSON.stringify([sourceRef, targetRef]);

		if (keys.has(key)) {
			throw new Error(`Duplicate ${label}: ${sourceRef} -> ${targetRef}`);
		}

		keys.add(key);
	}
};

export const validateConfigTransferGraph = (payload: ConfigTransferModel) => {
	const repositoryRefs = assertUniqueRefs(payload.repositories, "repository");
	const volumeRefs = assertUniqueRefs(payload.volumes, "volume");
	const scheduleRefs = assertUniqueRefs(payload.backupSchedules, "backup schedule");
	const destinationRefs = assertUniqueRefs(payload.notificationDestinations, "notification destination");

	for (const schedule of payload.backupSchedules) {
		assertReferenceExists(volumeRefs, schedule.volumeRef, "volume");
		assertReferenceExists(repositoryRefs, schedule.repositoryRef, "repository");
	}

	for (const mirror of payload.backupScheduleMirrors) {
		assertReferenceExists(scheduleRefs, mirror.scheduleRef, "backup schedule");
		assertReferenceExists(repositoryRefs, mirror.repositoryRef, "repository");
	}

	for (const notification of payload.backupScheduleNotifications) {
		assertReferenceExists(scheduleRefs, notification.scheduleRef, "backup schedule");
		assertReferenceExists(destinationRefs, notification.destinationRef, "notification destination");
	}

	assertUniqueAssignments(
		payload.backupScheduleMirrors.map((mirror) => [mirror.scheduleRef, mirror.repositoryRef] as const),
		"backup schedule mirror",
	);
	assertUniqueAssignments(
		payload.backupScheduleNotifications.map(
			(notification) => [notification.scheduleRef, notification.destinationRef] as const,
		),
		"backup schedule notification",
	);

	return payload;
};
