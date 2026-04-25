import { afterEach, expect, test, vi } from "vitest";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, fireEvent, render, screen, userEvent } from "~/test/test-utils";

const navigateMock = vi.fn(async () => {});

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();

	return {
		...actual,
		useNavigate: (() => navigateMock) as typeof actual.useNavigate,
	};
});

import { EditBackupPage } from "../edit-backup";

const repository = { shortId: "repo-1", name: "Repo 1", type: "local" };
const volume = {
	id: "volume-1",
	shortId: "vol-1",
	name: "Volume 1",
	config: { backend: "directory", path: "/mnt" },
};
const volumeFilesResponse = {
	files: [{ name: "project", path: "/project", type: "directory" }],
	path: "/",
	offset: 0,
	limit: 100,
	total: 1,
	hasMore: false,
};

const renderEditBackupPage = ({ enabled, cronExpression }: { enabled: boolean; cronExpression: string }) => {
	const submittedBody = new Promise<Record<string, unknown>>((resolve) => {
		server.use(
			http.get("/api/v1/backups/:shortId", () => {
				return HttpResponse.json({
					shortId: "backup-1",
					name: "Backup 1",
					enabled,
					repository,
					volume,
					cronExpression,
					retentionPolicy: null,
					includePaths: ["/project"],
					includePatterns: [],
					excludePatterns: [],
					excludeIfPresent: [],
					oneFileSystem: false,
					customResticParams: [],
					preBackupWebhook: null,
					postBackupWebhook: null,
				});
			}),
			http.get("/api/v1/repositories", () => {
				return HttpResponse.json([repository]);
			}),
			http.get("/api/v1/volumes/:shortId/files", () => {
				return HttpResponse.json(volumeFilesResponse);
			}),
			http.patch("/api/v1/backups/:shortId", async ({ request }) => {
				const body = (await request.json()) as Record<string, unknown>;
				resolve(body);

				return HttpResponse.json({
					shortId: "backup-1",
					volume,
					repository,
					...body,
				});
			}),
		);
	});

	render(<EditBackupPage backupId="backup-1" />, { withSuspense: true });

	return { submittedBody };
};

afterEach(() => {
	navigateMock.mockClear();
	cleanup();
});

test("submits the computed cron expression when saving a daily schedule", async () => {
	const { submittedBody } = renderEditBackupPage({ enabled: true, cronExpression: "0 2 * * *" });

	await userEvent.click(await screen.findByRole("button", { name: "Update schedule" }));

	await expect(submittedBody).resolves.toMatchObject({
		frequency: "daily",
		enabled: true,
		cronExpression: "00 02 * * *",
	});
});

test("disables the schedule when switching an enabled custom cron schedule to manual only", async () => {
	const { submittedBody } = renderEditBackupPage({ enabled: true, cronExpression: "*/13 * * * *" });

	const nativeFrequencySelect = (await screen.findAllByRole("combobox"))
		.at(1)
		?.parentElement?.querySelector('select[aria-hidden="true"]');
	if (!(nativeFrequencySelect instanceof HTMLSelectElement)) {
		throw new Error("Expected hidden native select for frequency field");
	}

	fireEvent.change(nativeFrequencySelect, { target: { value: "manual" } });
	await userEvent.click(screen.getByRole("button", { name: "Update schedule" }));

	await expect(submittedBody).resolves.toMatchObject({
		frequency: "manual",
		enabled: false,
		cronExpression: "",
	});
});

test("preserves a disabled schedule when saving a non-manual frequency", async () => {
	const { submittedBody } = renderEditBackupPage({ enabled: false, cronExpression: "0 2 * * *" });

	await userEvent.click(await screen.findByRole("button", { name: "Update schedule" }));

	await expect(submittedBody).resolves.toMatchObject({
		frequency: "daily",
		enabled: false,
		cronExpression: "00 02 * * *",
	});
});

test("submits webhook headers and body as plain config values", async () => {
	const { submittedBody } = renderEditBackupPage({ enabled: true, cronExpression: "0 2 * * *" });

	await userEvent.click(await screen.findByText("Advanced"));
	await userEvent.type(screen.getByLabelText("Pre-backup webhook"), "http://localhost:8080/stop");
	fireEvent.change(screen.getByLabelText("Pre-backup webhook headers"), {
		target: { value: "Authorization: Bearer stop-token" },
	});
	fireEvent.change(screen.getByLabelText("Pre-backup webhook body"), {
		target: { value: '{"action":"stop"}' },
	});
	await userEvent.click(screen.getByRole("button", { name: "Update schedule" }));

	await expect(submittedBody).resolves.toMatchObject({
		preBackupWebhook: {
			url: "http://localhost:8080/stop",
			headers: ["Authorization: Bearer stop-token"],
			body: '{"action":"stop"}',
		},
	});
});
