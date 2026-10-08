import { db } from "../../db/db";
import { readVolume } from "../../db/volume";
import { getOrganizationId } from "../../core/request-context";
import type { ShortId } from "../../utils/branded";

export const findVolume = async (shortId: ShortId) => {
	const organizationId = getOrganizationId();
	const volume = await db.query.volumesTable.findFirst({
		where: {
			AND: [{ shortId: { eq: shortId } }, { organizationId: organizationId }],
		},
	});

	return volume ? readVolume(volume) : undefined;
};
