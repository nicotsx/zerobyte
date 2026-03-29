import { NotFoundError } from "http-errors-enhanced";
import { db } from "../../../db/db";
import { getOrganizationId } from "~/server/core/request-context";
import { asShortId } from "~/server/utils/branded";

export async function getScheduleByIdOrShortId(idOrShortId: number | string) {
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: {
			AND: [
				{ OR: [{ id: Number(idOrShortId) }, { shortId: { eq: asShortId(String(idOrShortId)) } }] },
				{ organizationId },
			],
		},
		with: { volume: true, repository: true },
	});

	if (!schedule || !schedule.volume || !schedule.repository) {
		throw new NotFoundError("Backup schedule not found");
	}

	return schedule;
}
