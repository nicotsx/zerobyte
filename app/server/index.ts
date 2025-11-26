import { createHonoServer } from "react-router-hono-server/bun";
import * as fs from "node:fs/promises";
import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";
import { openAPIRouteHandler } from "hono-openapi";
import { getCapabilities } from "./core/capabilities";
import { runDbMigrations } from "./db/db";
import { authController } from "./modules/auth/auth.controller";
import { requireAuth } from "./modules/auth/auth.middleware";
import { driverController } from "./modules/driver/driver.controller";
import { startup } from "./modules/lifecycle/startup";
import { migrateToShortIds } from "./modules/lifecycle/migration";
import { repositoriesController } from "./modules/repositories/repositories.controller";
import { systemController } from "./modules/system/system.controller";
import { volumeController } from "./modules/volumes/volume.controller";
import { backupScheduleController } from "./modules/backups/backups.controller";
import { eventsController } from "./modules/events/events.controller";
import { notificationsController } from "./modules/notifications/notifications.controller";
import { handleServiceError } from "./utils/errors";
import { logger } from "./utils/logger";
import { shutdown } from "./modules/lifecycle/shutdown";
import { REQUIRED_MIGRATIONS, SOCKET_PATH } from "./core/constants";
import { validateRequiredMigrations } from "./modules/lifecycle/checkpoint";

export const generalDescriptor = (app: Hono) =>
	openAPIRouteHandler(app, {
		documentation: {
			info: {
				title: "Zerobyte API",
				version: "1.0.0",
				description: "API for managing volumes",
			},
			servers: [{ url: "http://192.168.2.42:4096", description: "Development Server" }],
		},
	});

export const scalarDescriptor = Scalar({
	title: "Zerobyte API Docs",
	pageTitle: "Zerobyte API Docs",
	url: "/api/v1/openapi.json",
});

const driver = new Hono().use(honoLogger()).route("/", driverController);
const app = new Hono()
	.use(honoLogger())
	.get("healthcheck", (c) => c.json({ status: "ok" }))
	.route("/api/v1/auth", authController.basePath("/api/v1"))
	.route("/api/v1/volumes", volumeController.use(requireAuth))
	.route("/api/v1/repositories", repositoriesController.use(requireAuth))
	.route("/api/v1/backups", backupScheduleController.use(requireAuth))
	.route("/api/v1/notifications", notificationsController.use(requireAuth))
	.route("/api/v1/system", systemController.use(requireAuth))
	.route("/api/v1/events", eventsController.use(requireAuth));

app.get("/api/v1/openapi.json", generalDescriptor(app));
app.get("/api/v1/docs", scalarDescriptor);

app.onError((err, c) => {
	logger.error(`${c.req.url}: ${err.message}`);

	if (err.cause instanceof Error) {
		logger.error(err.cause.message);
	}

	const { status, message } = handleServiceError(err);

	return c.json({ message }, status);
});

runDbMigrations();

await migrateToShortIds();
await validateRequiredMigrations(REQUIRED_MIGRATIONS);

const { docker } = await getCapabilities();

if (docker) {
	try {
		await fs.mkdir("/run/docker/plugins", { recursive: true });

		Bun.serve({
			unix: SOCKET_PATH,
			fetch: driver.fetch,
		});

		logger.info(`Docker volume plugin server running at ${SOCKET_PATH}`);
	} catch (error) {
		logger.error(`Failed to start Docker volume plugin server: ${error}`);
	}
}

startup();

logger.info(`Server is running at http://localhost:4096`);

export type AppType = typeof app;

process.on("SIGTERM", async () => {
	logger.info("SIGTERM received, starting graceful shutdown...");
	await shutdown();
	process.exit(0);
});

process.on("SIGINT", async () => {
	logger.info("SIGINT received, starting graceful shutdown...");
	await shutdown();
	process.exit(0);
});

export default await createHonoServer({ app, port: 4096 });
