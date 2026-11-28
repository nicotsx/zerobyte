import { z } from "zod";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { ConflictError } from "http-errors-enhanced";
import { bodyLimit } from "hono/body-limit";
import {
	AGENT_MAINTENANCE_ROUTE,
	AGENT_MAINTENANCE_MAX_REQUEST_BYTES,
	agentMaintenanceRequestSchema,
} from "@zerobyte/contracts/agent-maintenance";
import { validator } from "hono-openapi";
import { requireAuth, requirePermission } from "../auth/auth.middleware";
import { agentsService } from "./agents.service";
import { agentManager } from "./agents-manager";
import { getAgentBearerToken, isAllowedAgentRequest, isSecureAgentRequest } from "./helpers/auth";
import { validateRemoteAgentToken } from "./helpers/tokens";
import { agentUpdates } from "./agent-updates";
import { runEffectPromise } from "~/server/utils/errors";
import { serverHasRuntimeFeature } from "~/server/lib/permission-service";
import { AGENT_BUNDLE_PATH, REMOTE_AGENTS_UNAVAILABLE } from "./constants";
import {
	agentMaintenanceDto,
	requestAgentUpdateBody,
	requestAgentUpdateDto,
	deleteAgentDto,
	createAgentBody,
	createAgentDto,
	listAgentsDto,
	listAgentsQuery,
	revokeAgentTokenDto,
	rotateAgentTokenDto,
	type CreateAgentDto,
	type ListAgentsDto,
	type RevokeAgentTokenDto,
	type RotateAgentTokenDto,
} from "./agents.dto";

const enrollmentBody = z.strictObject({ code: z.string().min(1).max(512) });

export const agentsController = new Hono()
	.use(async (c, next) => {
		if (!serverHasRuntimeFeature("remoteAgents")) return c.json({ message: REMOTE_AGENTS_UNAVAILABLE }, 503);

		await next();
	})
	.post("/enroll", validator("json", enrollmentBody), async (c) => {
		if (!isAllowedAgentRequest(c.req.raw)) return c.json({ message: "TLS required" }, 426);

		const { code } = c.req.valid("json");
		const credentials = await agentsService.exchangeEnrollmentToken(code);

		c.header("Cache-Control", "no-store");
		return c.json(credentials);
	})
	.get("/download", async (c) => {
		try {
			const bundle = await readFile(AGENT_BUNDLE_PATH);

			c.header("Content-Type", "text/javascript");
			c.header("Cache-Control", "no-store");
			return c.body(bundle);
		} catch {
			return c.text("Agent bundle unavailable. Build Zerobyte before enrolling a remote agent.", 503);
		}
	})
	.post(
		AGENT_MAINTENANCE_ROUTE,
		agentMaintenanceDto,
		bodyLimit({
			maxSize: AGENT_MAINTENANCE_MAX_REQUEST_BYTES,
			onError: (c) => c.json({ message: "Request body too large" }, 413),
		}),
		validator("json", agentMaintenanceRequestSchema),
		async (c) => {
			c.header("Cache-Control", "no-store");
			if (!isSecureAgentRequest(c.req.raw)) return c.json({ message: "TLS required" }, 426);

			const token = getAgentBearerToken(c.req.raw);
			const identity = token ? await validateRemoteAgentToken(token) : null;
			if (!identity) return c.json({ message: "Unauthorized" }, 401);

			return c.json(agentUpdates.maintainAgent(identity, c.req.valid("json")));
		},
	)
	.use(requireAuth)
	.use(requirePermission("agents.manage"))
	.post("/:agentId/update", requestAgentUpdateDto, validator("json", requestAgentUpdateBody), async (c) => {
		const { targetTag, credentialVersion } = c.req.valid("json");
		c.req.raw.signal.throwIfAborted();

		const update = await runEffectPromise(
			agentUpdates.requestUpdate(
				c.get("authorizationGrant"),
				c.req.param("agentId"),
				targetTag,
				credentialVersion,
			),
			{ signal: c.req.raw.signal },
		);

		return c.json(update);
	})
	.delete("/:agentId", deleteAgentDto, async (c) => {
		const agentId = c.req.param("agentId");

		await agentManager.deleteRemoteAgent(c.get("organizationId"), agentId);
		return c.json({ success: true });
	})
	.get("/", validator("query", listAgentsQuery), listAgentsDto, async (c) => {
		const organizationId = c.get("organizationId");
		const { expectedOrganizationId } = c.req.valid("query");
		if (expectedOrganizationId !== undefined && expectedOrganizationId !== organizationId) {
			throw new ConflictError("The active organization changed");
		}

		const agents = await runEffectPromise(agentsService.listOrganizationAgents(organizationId), {
			signal: c.req.raw.signal,
		});

		c.header("Cache-Control", "no-store");
		return c.json<ListAgentsDto>(agents, 200);
	})
	.post("/", createAgentDto, validator("json", createAgentBody), async (c) => {
		const organizationId = c.get("organizationId");
		const body = c.req.valid("json");

		const enrollment = await agentsService.createRemoteAgent(organizationId, body.name);

		return c.json<CreateAgentDto>(enrollment, 201);
	})
	.post("/:agentId/token/rotate", rotateAgentTokenDto, async (c) => {
		const organizationId = c.get("organizationId");
		const agentId = c.req.param("agentId");

		const rotation = await agentManager.rotateRemoteAgentToken(organizationId, agentId);
		return c.json<RotateAgentTokenDto>(rotation, 200);
	})
	.delete("/:agentId/token", revokeAgentTokenDto, async (c) => {
		const organizationId = c.get("organizationId");
		const agentId = c.req.param("agentId");

		const agent = await agentManager.revokeRemoteAgentToken(organizationId, agentId);
		return c.json<RevokeAgentTokenDto>(agent, 200);
	});
