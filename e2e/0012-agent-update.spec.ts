import { execFileSync } from "node:child_process";
import { expect, test, type APIResponse } from "@playwright/test";
import type {
	CreateBackupScheduleResponse,
	CreateRemoteAgentResponse,
	CreateRepositoryResponse,
	CreateVolumeResponse,
	GetBackupScheduleResponse,
	ListAgentsResponse,
} from "../app/client/api-client/types.gen";
import { gotoAndWaitForAppReady } from "./helpers/page";

async function json<T>(response: APIResponse): Promise<T> {
	if (!response.ok()) throw new Error(`${response.url()} returned ${response.status()}: ${await response.text()}`);
	return response.json();
}

test("a systemd agent updates from Machines and runs its next backup", async ({ page }) => {
	test.setTimeout(180_000);
	const container = process.env.E2E_AGENT_UPDATE_CONTAINER!;
	const initial = process.env.E2E_AGENT_UPDATE_INITIAL!;
	const target = process.env.E2E_AGENT_UPDATE_TARGET!;
	const name = "Update test machine";
	const service = "zerobyte-agent.service";
	const docker = (args: string[], input?: string) =>
		execFileSync("docker", ["exec", "-i", container, ...args], { encoding: "utf8", input, timeout: 55_000 }).trim();

	await expect
		.poll(
			async () =>
				page.request
					.get("/api/healthcheck")
					.then((response) => response.ok())
					.catch(() => false),
			{ timeout: 35_000 },
		)
		.toBe(true);

	await gotoAndWaitForAppReady(page, "/onboarding");
	await page.getByRole("textbox", { name: "Email" }).fill("agent-update@example.test");
	await page.getByRole("textbox", { name: "Username" }).fill("agent-update");
	await page.getByRole("textbox", { name: "Password", exact: true }).fill("password123");
	await page.getByRole("textbox", { name: "Confirm Password" }).fill("password123");
	await page.getByRole("button", { name: "Create admin user" }).click();
	await expect(page.getByText("Download Your Recovery Key")).toBeVisible();
	await page.getByRole("textbox", { name: "Confirm Your Password" }).fill("password123");
	const download = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download Recovery Key" }).click();
	await download;
	await expect(page).toHaveURL(/\/volumes$/);

	const { agent, token } = await json<CreateRemoteAgentResponse>(
		await page.request.post("/api/v1/agents", { data: { name } }),
	);
	docker(
		[
			"sh",
			"-ec",
			`mkdir -p /backup-source /etc/systemd/system/${service}.d
		 printf 'updated agent backup fixture\\n' > /backup-source/example.txt
		 printf '[Service]\\nEnvironment=NODE_EXTRA_CA_CERTS=/e2e/tls.pem\\n' > /etc/systemd/system/${service}.d/test-ca.conf
		 NODE_EXTRA_CA_CERTS=/e2e/tls.pem /e2e/zerobyte-agent-old install --controller https://127.0.0.1:8443 --code-stdin --root /backup-source`,
		],
		`${token}\n`,
	);
	const mainPid = () => docker(["systemctl", "show", service, "--property=MainPID", "--value"]);
	const oldPid = mainPid();
	expect(Number(oldPid)).toBeGreaterThan(0);

	await gotoAndWaitForAppReady(page, "/settings?scope=organization#machines");
	const row = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });
	await expect(row.getByText(`Agent ${initial}`)).toBeVisible();
	await expect(row.getByText("Update available")).toBeVisible();
	await row.getByRole("button", { name: `Update agent for ${name}` }).click();
	const dialog = page.getByRole("alertdialog");
	await expect(dialog.getByText(target, { exact: false })).toBeVisible();
	await dialog.getByRole("button", { name: "Queue update" }).click();

	await expect(row.getByText(`Update to ${target} completed. The updated agent reconnected.`)).toBeVisible({
		timeout: 90_000,
	});
	await expect(row.getByText(`Agent ${target}`)).toBeVisible();
	expect(docker(["systemctl", "is-active", service])).toBe("active");
	expect(Number(mainPid())).toBeGreaterThan(0);
	expect(mainPid()).not.toBe(oldPid);
	expect(docker(["sha256sum", "/usr/local/bin/zerobyte-agent"]).split(" ")[0]).toBe(
		process.env.E2E_AGENT_UPDATE_DIGEST,
	);

	const agents = await json<ListAgentsResponse>(await page.request.get("/api/v1/agents"));
	const updated = agents.find(({ id }) => id === agent.id);
	expect(updated?.status).toBe("online");
	expect(updated?.capabilities.agentVersion).toBe(target);
	const root = updated?.capabilities.trustedRoots?.[0];
	if (!root) throw new Error("The updated agent did not advertise its backup source");

	const volume = await json<CreateVolumeResponse>(
		await page.request.post("/api/v1/volumes", {
			data: {
				sourceKind: "filesystem",
				name: "Update test source",
				agentId: agent.id,
				trustedRootId: root.id,
				relativePath: "",
			},
		}),
	);
	const { repository } = await json<CreateRepositoryResponse>(
		await page.request.post("/api/v1/repositories", {
			data: { name: "Update test repository", config: { backend: "rest", url: "http://127.0.0.1:8000/e2e" } },
		}),
	);
	const schedule = await json<CreateBackupScheduleResponse>(
		await page.request.post("/api/v1/backups", {
			data: {
				name: "Backup after update",
				volumeId: volume.id,
				repositoryId: repository.id,
				enabled: true,
				cronExpression: "0 0 1 1 *",
			},
		}),
	);
	const run = await page.request.post(`/api/v1/backups/${schedule.shortId}/run`, {
		headers: { Origin: new URL(page.url()).origin },
	});
	expect(run.status(), await run.text()).toBe(202);
	await expect
		.poll(
			async () => {
				const backup = await json<GetBackupScheduleResponse>(
					await page.request.get(`/api/v1/backups/${schedule.shortId}`),
				);
				return backup.lastBackupStatus;
			},
			{ timeout: 30_000 },
		)
		.toBe("success");
});
