import { Scheduler } from "../../core/scheduler";
import { db } from "../../db/db";
import { logger } from "@zerobyte/core/node";
import { stopApplicationRuntime } from "./bootstrap";
import { withContext } from "../../core/request-context";
import { volumeService } from "../volumes/volume.service";
import { toMessage } from "../../utils/errors";
import { config } from "../../core/config";
import { LOCAL_AGENT_ID } from "../agents/constants";

export const shutdown = async () => {
	await Scheduler.stop();

	if (!config.flags.enableLocalAgent) {
		const volumes = await db.query.volumesTable.findMany({
			where: { AND: [{ status: "mounted" }, { agentId: LOCAL_AGENT_ID }] },
		});

		for (const volume of volumes) {
			const { status, error } = await withContext({ organizationId: volume.organizationId }, () =>
				volumeService.unmountVolume(volume.shortId, { persistStatus: false }),
			).catch((error) => ({ status: "error" as const, error: toMessage(error) }));

			logger.info(`Volume ${volume.name} unmount status: ${status}${error ? `, error: ${error}` : ""}`);
		}
	}

	await stopApplicationRuntime();
};
