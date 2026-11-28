import { toAgentConnectionUrl, toControllerOrigin } from "@zerobyte/contracts/agent-connection";
import { parseAgentToken } from "@zerobyte/contracts/agent-token";
import { toMessage } from "@zerobyte/core/utils";
import { Data, Effect } from "effect";
import { z } from "zod";
import { allowsInsecureHttp, type AgentConfiguration } from "./config";
import { createTrustedRootRegistry, resolveConfiguredRootPath } from "./trusted-roots";

export class EnrollmentError extends Data.TaggedError("EnrollmentError")<{ message: string }> {}

const enrollmentResponseSchema = z.object({ token: z.string() });
const enrollmentErrorSchema = z.object({ message: z.string().trim().min(1) });

const DEFAULT_RECOVERY = "Check the controller URL and the Zerobyte server and reverse proxy logs.";

const RECOVERY_BY_STATUS: Record<number, string> = {
	401: "The connection code is invalid, expired, already used, or revoked. Get a fresh connection command from this machine's Actions menu in Settings → Machines.",
	403: "Check the reverse proxy's access rules. The agent must be able to reach /api/v1/agents/enroll.",
	404: "Check the controller URL and that this Zerobyte server version supports remote agents.",
	426: "Use HTTPS. If a trusted reverse proxy terminates TLS, set TRUST_PROXY=true on the Zerobyte server and ensure the proxy sends X-Forwarded-Proto: https. This rejection has not consumed your connection code.",
	429: "Too many enrollment attempts. Wait before retrying.",
	503: "Check that remote agents are enabled with ENABLE_REMOTE_AGENTS=true on the Zerobyte server. If they are, check the server and reverse proxy logs for an outage.",
};

export const parseControllerUrl = (value: string, allowInsecure = false) =>
	Effect.try({
		try: () => new URL(value),
		catch: () => new EnrollmentError({ message: `Invalid controller URL: ${value}` }),
	}).pipe(
		Effect.filterOrFail(
			(url) => {
				if (url.username || url.password) return false;
				if (url.protocol === "https:") return true;

				return url.protocol === "http:" && (allowInsecure || allowsInsecureHttp());
			},
			() =>
				new EnrollmentError({
					message:
						"Use an HTTPS controller URL without embedded credentials. To allow insecure HTTP, set ZEROBYTE_AGENT_ALLOW_INSECURE_HTTP=true or use --allow-insecure.",
				}),
		),
	);

export const exchangeConnectionCode = (controller: URL, code: string) =>
	Effect.gen(function* () {
		const redact = (text: string) => text.replaceAll(code, "[redacted]").slice(0, 500);

		const { response, body } = yield* Effect.tryPromise({
			try: async (signal) => {
				const response = await fetch(new URL("/api/v1/agents/enroll", controller), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ code }),
					redirect: "error",
					signal,
				});
				const body = await response.json().catch(() => null);

				return { response, body };
			},
			catch: (error) =>
				new EnrollmentError({
					message: `Enrollment request to ${controller.origin} failed: ${redact(toMessage(error))}. Check the controller URL, network access, HTTPS certificates, and reverse proxy configuration.`,
				}),
		}).pipe(
			Effect.timeoutOrElse({
				duration: "15 seconds",
				orElse: () =>
					Effect.fail(
						new EnrollmentError({
							message: `Enrollment request to ${controller.origin} timed out. Check network access.`,
						}),
					),
			}),
		);

		if (!response.ok) {
			const detail =
				enrollmentErrorSchema.safeParse(body).data?.message ??
				(response.statusText || "The controller rejected enrollment.");
			const recovery = RECOVERY_BY_STATUS[response.status] ?? DEFAULT_RECOVERY;

			return yield* new EnrollmentError({
				message: `Enrollment failed (${response.status}): ${redact(detail)} ${recovery}`,
			});
		}

		const credentials = enrollmentResponseSchema.safeParse(body);

		if (!credentials.success) {
			return yield* new EnrollmentError({
				message: `Zerobyte returned an invalid machine credential from ${controller.origin}. Check the controller URL and server version, and ensure any proxy or authentication gateway allows /api/v1/agents/enroll to return JSON.`,
			});
		}

		return credentials.data.token;
	});

export const enrollMachine = (controller: URL, code: string, folders: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const roots = folders.map((folder, index) => ({
			id: `files-${index + 1}`,
			label: `Files ${index + 1}`,
			path: resolveConfiguredRootPath(folder),
			allowBackup: true,
		}));

		yield* Effect.try({
			try: () => createTrustedRootRegistry({ roots }),
			catch: (error) => new EnrollmentError({ message: toMessage(error) }),
		});

		const token = yield* exchangeConnectionCode(controller, code);

		return { controllerUrl: toAgentConnectionUrl(controller).href, token, roots } satisfies AgentConfiguration;
	});

export const reconnectMachine = (saved: AgentConfiguration, controller: URL, code: string, configPath: string) =>
	Effect.gen(function* () {
		const enrollment = parseAgentToken(code);
		if (!enrollment) {
			return yield* new EnrollmentError({
				message: `The connection code is incomplete or invalid. Copy a fresh code from Settings → Machines on ${controller.origin}.`,
			});
		}

		const machineId = parseAgentToken(saved.token)?.agentId;
		if (!machineId) {
			return yield* new EnrollmentError({
				message: `The saved agent credential in ${configPath} is invalid. Restore a working configuration, or stop the agent, move the file aside, and enroll again with a fresh code.`,
			});
		}

		if (enrollment.agentId !== machineId) {
			const savedAddress = URL.parse(saved.controllerUrl);
			const savedController = savedAddress && toControllerOrigin(savedAddress);

			if (savedController && savedController !== controller.origin) {
				return yield* new EnrollmentError({
					message: `This agent is already enrolled with ${savedController}. To switch to ${controller.origin}, stop the agent, move ${configPath} aside, and enroll with a fresh code. Select your allowed folders again after enrollment.`,
				});
			}

			return yield* new EnrollmentError({
				message:
					"This agent is already enrolled and the code is for a different machine entry. In Settings → Machines, choose Actions → Get connection command on the existing entry.",
			});
		}

		const token = yield* exchangeConnectionCode(controller, code);

		if (parseAgentToken(token)?.agentId !== machineId) {
			return yield* new EnrollmentError({
				message:
					"Controller returned a credential for a different machine. The saved agent configuration was not changed.",
			});
		}

		return { ...saved, controllerUrl: toAgentConnectionUrl(controller).href, token } satisfies AgentConfiguration;
	});
