import { createHonoServer } from "react-router-hono-server/bun";
import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";
import { openAPIRouteHandler } from "hono-openapi";
import { runDbMigrations } from "./db/db";
import { authController } from "./modules/auth/auth.controller";
import { requireAuth } from "./modules/auth/auth.middleware";
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
import { REQUIRED_MIGRATIONS } from "./core/constants";
import { validateRequiredMigrations } from "./modules/lifecycle/checkpoint";
import { configExportController } from "./modules/lifecycle/config-export.controller";
import { config } from "./core/config";


export const generalDescriptor = (app: Hono) =>
	openAPIRouteHandler(app, {
		documentation: {
			info: {
				title: "Zerobyte API",
				version: "1.0.0",
				description: "API for managing volumes",
			},
			servers: [{ url: `http://${config.serverIp}:4096`, description: "Development Server" }],
		},
	});

export const scalarDescriptor = Scalar({
	title: "Zerobyte API Docs",
	pageTitle: "Zerobyte API Docs",
	url: "/api/v1/openapi.json",
});

const app = new Hono()
	.use(honoLogger())
	.get("healthcheck", (c) => c.json({ status: "ok" }))
	.route("/api/v1/auth", authController.basePath("/api/v1"))
	.use("/api/v1/volumes/*", requireAuth)
	.use("/api/v1/repositories/*", requireAuth)
	.use("/api/v1/backups/*", requireAuth)
	.use("/api/v1/notifications/*", requireAuth)
	.use("/api/v1/system/*", requireAuth)
	.use("/api/v1/events/*", requireAuth)
	.use("/api/v1/config/*", requireAuth)
	.route("/api/v1/volumes", volumeController)
	.route("/api/v1/repositories", repositoriesController)
	.route("/api/v1/backups", backupScheduleController)
	.route("/api/v1/notifications", notificationsController)
	.route("/api/v1/system", systemController)
	.route("/api/v1/events", eventsController)
	.route("/api/v1/config", configExportController);


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
