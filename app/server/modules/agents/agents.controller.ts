import { z } from "zod";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { validator } from "hono-openapi";
import { requireAuth, requirePermission } from "../auth/auth.middleware";
import { agentsService } from "./agents.service";
import { agentManager } from "./agents-manager";
import { isAllowedAgentRequest } from "./helpers/auth";
import { serverHasRuntimeFeature } from "~/server/lib/permission-service";
import { AGENT_BUNDLE_PATH, REMOTE_AGENTS_UNAVAILABLE } from "./constants";
import {
	deleteAgentDto,
	createAgentBody,
	createAgentDto,
	listAgentsDto,
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
	.use(requireAuth)
	.use(requirePermission("agents.manage"))
	.delete("/:agentId", deleteAgentDto, async (c) => {
		const agentId = c.req.param("agentId");

		await agentManager.deleteRemoteAgent(c.get("organizationId"), agentId);
		return c.json({ success: true });
	})
	.get("/", listAgentsDto, async (c) => {
		const organizationId = c.get("organizationId");
		const agents = await agentsService.listOrganizationAgents(organizationId);

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
