import { Effect } from "effect";
import { ServiceUnavailableError } from "http-errors-enhanced";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { RepositoryConfig } from "@zerobyte/core/restic";
import { LOCAL_AGENT_ID } from "~/server/modules/agents/constants";
import { agentManager } from "~/server/modules/agents/agents-manager";
import { restic, resticDeps } from "~/server/core/restic";
import { assertAgentOnline, resticForAgent } from "../repository-restic";

vi.mock("~/server/core/restic", () => ({
	restic: { snapshots: vi.fn(), copy: vi.fn() },
	resticDeps: {
		getOrganizationResticPassword: vi.fn(),
		resolveSecret: vi.fn(),
	},
}));

vi.mock("~/server/modules/agents/agents-manager", () => ({
	agentManager: {
		runResticCommand: vi.fn(),
		isAgentReady: vi.fn(),
	},
}));

vi.mock("../repository-config-secrets", () => ({
	decryptRepositoryConfig: vi.fn(async (config: RepositoryConfig) => ({ ...config, cacert: "decrypted" })),
}));

const agentRuns = vi.mocked(agentManager.runResticCommand);
const agentReady = vi.mocked(agentManager.isAgentReady);

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(resticDeps.getOrganizationResticPassword).mockResolvedValue("encrypted-org-password");
	vi.mocked(resticDeps.resolveSecret).mockImplementation(async (value: string) => `plain(${value})`);
	agentReady.mockReturnValue(true);
});

describe("resticForAgent", () => {
	test("runs the built-in agent's repositories with the local restic", () => {
		expect(resticForAgent(LOCAL_AGENT_ID)).toBe(restic);
	});

	test("sends snapshot listings to the owning machine with decrypted config and the organization password", async () => {
		agentRuns.mockReturnValue(Effect.succeed([{ id: "snapshot-1" }]) as never);

		const result = await Effect.runPromise(
			resticForAgent("agent-1").snapshots(
				{ backend: "local", path: "/srv/repo" },
				{ organizationId: "org-1", tags: ["schedule-1"] },
			),
		);

		expect(result).toEqual([{ id: "snapshot-1" }]);
		expect(agentRuns).toHaveBeenCalledWith("agent-1", {
			organizationId: "org-1",
			repositoryConfig: { backend: "local", path: "/srv/repo", cacert: "decrypted" },
			runtime: { password: "plain(encrypted-org-password)" },
			command: { name: "restic.snapshots", tags: ["schedule-1"] },
			signal: undefined,
			onMessage: undefined,
		});
	});

	test("never resolves the organization password for a repository with its own password", async () => {
		agentRuns.mockReturnValue(Effect.succeed({ success: true, error: null }) as never);

		await Effect.runPromise(
			resticForAgent("agent-1").init(
				{ backend: "local", path: "/srv/repo", isExistingRepository: true, customPassword: "custom" },
				{ organizationId: "org-1" },
			),
		);

		expect(resticDeps.getOrganizationResticPassword).not.toHaveBeenCalled();
		expect(agentRuns).toHaveBeenCalledWith(
			"agent-1",
			expect.objectContaining({
				repositoryConfig: expect.objectContaining({ customPassword: "custom" }),
				runtime: { password: "custom" },
				command: { name: "restic.init", timeoutMs: undefined },
			}),
		);
	});

	test.each([
		["only the source has its own password", false, "plain(encrypted-org-password)"],
		["both repositories have their own password", true, "source-password"],
	])("copy where %s sends the matching fallback password", async (_name, destinationIsExisting, expected) => {
		agentRuns.mockReturnValue(Effect.succeed({ success: true, error: null }) as never);

		await Effect.runPromise(
			resticForAgent("agent-1").copy(
				{
					backend: "local",
					path: "/srv/source",
					isExistingRepository: true,
					customPassword: "source-password",
				},
				{
					backend: "rest",
					url: "https://rest.example.test",
					isExistingRepository: destinationIsExisting,
					customPassword: "destination-password",
				} as RepositoryConfig,
				{ organizationId: "org-1", tag: "schedule-1", snapshotIds: ["abc"] },
			),
		);

		expect(agentRuns).toHaveBeenCalledWith("agent-1", expect.objectContaining({ runtime: { password: expected } }));
	});

	test("copies from the source config into a destination config the owning machine can reach", async () => {
		agentRuns.mockReturnValue(Effect.succeed({ success: true, error: null }) as never);

		await Effect.runPromise(
			resticForAgent("agent-1").copy(
				{ backend: "local", path: "/srv/source" },
				{ backend: "rest", url: "https://rest.example.test" } as RepositoryConfig,
				{ organizationId: "org-1", tag: "schedule-1", snapshotIds: ["abc"], customResticParams: ["--limit"] },
			),
		);

		expect(agentRuns).toHaveBeenCalledWith(
			"agent-1",
			expect.objectContaining({
				repositoryConfig: { backend: "local", path: "/srv/source", cacert: "decrypted" },
				command: {
					name: "restic.copy",
					destinationConfig: { backend: "rest", url: "https://rest.example.test", cacert: "decrypted" },
					tag: "schedule-1",
					snapshotIds: ["abc"],
					customResticParams: ["--limit"],
				},
			}),
		);
	});
});

describe("assertAgentOnline", () => {
	test("rejects work for a repository whose machine is not ready", () => {
		agentReady.mockReturnValue(false);

		expect(() => assertAgentOnline("agent-1")).toThrow(ServiceUnavailableError);
		expect(() => assertAgentOnline("agent-1")).toThrow("offline");
	});

	test("never checks the built-in agent, which runs repositories on this server", () => {
		agentReady.mockReturnValue(false);

		expect(() => assertAgentOnline(LOCAL_AGENT_ID)).not.toThrow();
		expect(agentReady).not.toHaveBeenCalled();
	});
});
