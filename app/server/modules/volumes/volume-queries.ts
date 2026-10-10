import { db } from "../../db/db";
import { getOrganizationId } from "../../core/request-context";
import type { ShortId } from "../../utils/branded";

export const findVolume = async (shortId: ShortId) => {
	const organizationId = getOrganizationId();
	return await db.query.volumesTable.findFirst({
		where: {
			AND: [{ shortId: { eq: shortId } }, { organizationId: organizationId }],
		},
	});
};
