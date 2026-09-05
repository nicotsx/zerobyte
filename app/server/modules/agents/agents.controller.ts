import { z } from "zod";
import { config } from "../../core/config";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { validator } from "hono-openapi";
import { requireAuth, requirePermission } from "../auth/auth.middleware";
import { agentManager } from "./agents-manager";
import { logger } from "@zerobyte/core/node";
import { agentsService } from "./agents.service";
import { agentEnrollmentService } from "./agent-enrollment.service";
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
	.post("/enroll", validator("json", enrollmentBody), async (c) => {
		if (config.runtime !== "server") return c.json({ message: "Remote agents are unavailable" }, 503);

		const url = new URL(c.req.url);
		const forwardedProtocol = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
		const secure = url.protocol === "https:" || (config.trustProxy && forwardedProtocol === "https");

		if (config.environment !== "development" && !secure) return c.json({ message: "TLS required" }, 426);

		const { code } = c.req.valid("json");
		const credentials = await agentsService.exchangeEnrollmentToken(code);

		c.header("Cache-Control", "no-store");
		return c.json(credentials);
	})
	.get("/download", async (c) => {
		if (config.runtime !== "server") return c.text("Remote agents are unavailable", 503);

		try {
			const bundle = await readFile(".output/agent/index.mjs");

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

		await agentsService.deleteRemoteAgent(c.get("organizationId"), agentId);
		await agentManager
			.disconnectAgent(agentId)
			.catch(() => logger.warn(`Failed to disconnect deleted agent ${agentId}`));

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

		const enrollment = await agentEnrollmentService.createRemoteAgent(organizationId, body.name);

		return c.json<CreateAgentDto>(enrollment, 201);
	})
	.post("/:agentId/token/rotate", rotateAgentTokenDto, async (c) => {
		const organizationId = c.get("organizationId");
		const agentId = c.req.param("agentId");

		const rotation = await agentEnrollmentService.rotateRemoteAgentToken(organizationId, agentId);

		return c.json<RotateAgentTokenDto>(rotation, 200);
	})
	.delete("/:agentId/token", revokeAgentTokenDto, async (c) => {
		const organizationId = c.get("organizationId");
		const agentId = c.req.param("agentId");

		const agent = await agentEnrollmentService.revokeRemoteAgentToken(organizationId, agentId);

		return c.json<RevokeAgentTokenDto>(agent, 200);
	});
