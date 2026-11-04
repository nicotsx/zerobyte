import { afterEach, expect, test, vi } from "vitest";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent } from "~/test/test-utils";
import { STORED_SECRET } from "~/lib/stored-secret";

const navigateMock = vi.fn(async () => {});

const testState = vi.hoisted(() => ({ remoteAgents: false }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();

	return {
		...actual,
		useNavigate: (() => navigateMock) as typeof actual.useNavigate,
	};
});

vi.mock("@tanstack/react-start", () => ({
	useServerFn: () => async () => ({ REPOSITORY_BASE: "/repositories" }),
}));

vi.mock("~/server/lib/functions/server-constants", () => ({
	getServerConstants: vi.fn(),
}));

vi.mock("~/client/hooks/use-permissions", () => ({
	usePermissions: () => ({
		can: () => false,
		hasRuntimeFeature: (feature: string) => feature === "remoteAgents" && testState.remoteAgents,
	}),
}));

vi.mock("~/client/hooks/use-system-info", () => ({
	useSystemInfo: () => ({
		capabilities: {
			repositoryBackends: ["local", "s3"],
		},
	}),
}));

import { CreateRepositoryPage } from "../create-repository";
import { EditRepositoryPage } from "../edit-repository";

const repository = {
	id: "repository-1",
	shortId: "repo-1",
	agentId: "local",
	agentName: null,
	provisioningId: null,
	name: "Repository 1",
	type: "local",
	config: { backend: "local", path: "/repositories" },
	compressionMode: "auto",
	status: "healthy",
	lastChecked: null,
	lastError: null,
	doctorResult: null,
	autoCheckEnabled: false,
	createdAt: 0,
	updatedAt: 0,
};

const selectBackend = async (backend: string) => {
	await userEvent.click(screen.getByRole("combobox", { name: "Backend" }));
	await userEvent.click(await screen.findByRole("option", { name: backend }));
};

afterEach(() => {
	navigateMock.mockClear();
	testState.remoteAgents = false;
	cleanup();
});

test("saves repository edits while preserving stored credentials", async () => {
	const config = {
		backend: "s3",
		endpoint: "s3.example.com",
		bucket: "backups",
		accessKeyId: STORED_SECRET,
		secretAccessKey: STORED_SECRET,
	};
	let submittedBody: Record<string, unknown> | undefined;
	server.use(
		http.get("/api/v1/repositories/repo-1", () => HttpResponse.json({ ...repository, type: "s3", config })),
		http.patch("/api/v1/repositories/repo-1", async ({ request }) => {
			submittedBody = (await request.json()) as Record<string, unknown>;
			return HttpResponse.json({ ...repository, config });
		}),
	);

	render(<EditRepositoryPage repositoryId="repo-1" />, { withSuspense: true });
	expect(await screen.findByLabelText("Access Key ID")).toHaveProperty("value", "Stored credential");
	expect(screen.getByLabelText("Secret Access Key")).toHaveProperty("value", "Stored credential");
	expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
	await userEvent.clear(screen.getByLabelText("Name"));
	await userEvent.type(screen.getByLabelText("Name"), "Renamed repository");
	await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));
	await expect.poll(() => submittedBody).toMatchObject({ name: "Renamed repository", config });
});

test("clears an optional stored credential through repository form validation", async () => {
	const config = { backend: "rest", url: "https://backup.example.com", username: "backup", password: STORED_SECRET };
	let submittedBody: Record<string, unknown> | undefined;
	server.use(
		http.get("/api/v1/repositories/repo-1", () => HttpResponse.json({ ...repository, type: "rest", config })),
		http.patch("/api/v1/repositories/repo-1", async ({ request }) => {
			submittedBody = (await request.json()) as Record<string, unknown>;
			return HttpResponse.json({ ...repository, config });
		}),
	);

	render(<EditRepositoryPage repositoryId="repo-1" />, { withSuspense: true });
	await screen.findByLabelText("Password (Optional)");
	await userEvent.click(screen.getByRole("button", { name: "Clear" }));
	await userEvent.click(screen.getByRole("button", { name: "Clear credential" }));
	expect(submittedBody).toBeUndefined();
	await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));
	await expect.poll(() => submittedBody).toMatchObject({ config: { ...config, password: "" } });
});

test("creates repositories with scheduled health checks enabled by default and preserves the choice across backend changes", async () => {
	let submittedBody: Record<string, unknown> | undefined;

	server.use(
		http.post("/api/v1/repositories", async ({ request }) => {
			submittedBody = (await request.json()) as Record<string, unknown>;

			return HttpResponse.json(
				{
					repository: { id: "repository-1", shortId: "repo-1", name: "Repository 1" },
					message: "Repository created",
				},
				{ status: 201 },
			);
		}),
	);

	render(<CreateRepositoryPage />, { withSuspense: true });

	const healthCheckCheckbox = await screen.findByRole("checkbox", {
		name: "Enable scheduled repository health checks",
	});
	expect(healthCheckCheckbox.getAttribute("data-state")).toBe("checked");

	await userEvent.click(healthCheckCheckbox);
	await selectBackend("Local");
	await selectBackend("S3");
	expect(healthCheckCheckbox.getAttribute("data-state")).toBe("unchecked");

	await userEvent.click(healthCheckCheckbox);
	await selectBackend("Local");
	await userEvent.type(screen.getByLabelText("Name"), "Repository 1");
	await userEvent.click(screen.getByRole("button", { name: "Create repository" }));

	await expect.poll(() => submittedBody).toBeDefined();
	expect(submittedBody).toMatchObject({ autoCheckEnabled: true });
	const submittedConfig = submittedBody?.config as Record<string, unknown>;
	expect("autoCheckEnabled" in submittedConfig).toBe(false);
});

test("creates a repository on a remote machine in one of its locations that allows repositories", async () => {
	testState.remoteAgents = true;
	let submittedBody: Record<string, unknown> | undefined;

	server.use(
		http.get("/api/v1/volumes/source-machines", () =>
			HttpResponse.json([
				{
					id: "nas",
					name: "NAS",
					status: "online",
					lastSeenAt: null,
					revokedAt: null,
					trustedRoots: [
						{ id: "photos", label: "Photos", canBackup: true, canStoreRepository: false },
						{ id: "disk", label: "Backup disk", canBackup: false, canStoreRepository: true },
					],
				},
			]),
		),
		http.post("/api/v1/repositories", async ({ request }) => {
			submittedBody = (await request.json()) as Record<string, unknown>;

			return HttpResponse.json(
				{
					repository: { id: "repository-1", shortId: "repo-1", name: "Repository 1" },
					message: "Repository created",
				},
				{ status: 201 },
			);
		}),
	);

	render(<CreateRepositoryPage />, { withSuspense: true });

	await userEvent.click(await screen.findByLabelText("Another machine"));
	expect(screen.queryByRole("combobox", { name: "Backend" })).toBeNull();
	const nameInput = screen.getByLabelText("Name");
	const machineSelect = await screen.findByRole("combobox", { name: "Machine" });
	const compressionSelect = screen.getByRole("combobox", { name: "Compression Mode" });
	expect(nameInput.compareDocumentPosition(machineSelect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	expect(machineSelect.compareDocumentPosition(compressionSelect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	await userEvent.click(await screen.findByRole("combobox", { name: "Machine" }));
	expect(screen.queryByRole("option", { name: "This server" })).toBeNull();
	await userEvent.click(await screen.findByRole("option", { name: "NAS · Online" }));
	await userEvent.click(await screen.findByRole("combobox", { name: "Location" }));
	expect(
		(await screen.findByRole("option", { name: "Photos · Repositories disabled" })).getAttribute("aria-disabled"),
	).toBe("true");
	await userEvent.click(screen.getByRole("option", { name: "Backup disk" }));
	await userEvent.click(screen.getByRole("button", { name: "Choose folder" }));
	await userEvent.click(screen.getByRole("button", { name: "Select entire location" }));
	await userEvent.type(screen.getByLabelText("Name"), "Repository 1");
	await userEvent.click(screen.getByRole("button", { name: "Create repository" }));

	await expect.poll(() => submittedBody).toBeDefined();
	expect(submittedBody).toMatchObject({
		agentId: "nas",
		config: { backend: "local", trustedRootId: "disk", path: "." },
	});
});

test("explains how to allow repositories when the machine has no such location", async () => {
	testState.remoteAgents = true;

	server.use(
		http.get("/api/v1/volumes/source-machines", () =>
			HttpResponse.json([
				{
					id: "nas",
					name: "NAS",
					status: "online",
					lastSeenAt: null,
					revokedAt: null,
					trustedRoots: [{ id: "photos", label: "Photos", canBackup: true, canStoreRepository: false }],
				},
			]),
		),
	);

	render(<CreateRepositoryPage />, { withSuspense: true });

	await userEvent.click(await screen.findByLabelText("Another machine"));
	await userEvent.click(await screen.findByRole("combobox", { name: "Machine" }));
	await userEvent.click(await screen.findByRole("option", { name: "NAS · Online" }));

	expect(await screen.findByText(/No location on NAS allows repositories/)).toBeTruthy();
	expect(screen.queryByRole("combobox", { name: "Location" })).toBeNull();
});

test("a local repository on this server does not ask for a machine", async () => {
	testState.remoteAgents = true;

	render(<CreateRepositoryPage />, { withSuspense: true });

	expect(((await screen.findByLabelText("This server")) as HTMLInputElement).checked).toBe(true);
	await selectBackend("Local");

	expect(await screen.findByText("Repository Directory")).toBeTruthy();
	expect(screen.queryByRole("combobox", { name: "Machine" })).toBeNull();
	expect(screen.queryByRole("combobox", { name: "Location" })).toBeNull();
});

test("initializes and updates scheduled health checks without adding it to repository config", async () => {
	let submittedBody: Record<string, unknown> | undefined;

	server.use(
		http.get("/api/v1/repositories/:shortId", () => HttpResponse.json(repository)),
		http.patch("/api/v1/repositories/:shortId", async ({ request }) => {
			submittedBody = (await request.json()) as Record<string, unknown>;

			return HttpResponse.json({ ...repository, ...submittedBody });
		}),
	);

	render(<EditRepositoryPage repositoryId="repo-1" />, { withSuspense: true });

	const healthCheckCheckbox = await screen.findByRole("checkbox", {
		name: "Enable scheduled repository health checks",
	});
	expect(healthCheckCheckbox.getAttribute("data-state")).toBe("unchecked");
	expect(screen.getByText("/repositories")).toBeTruthy();
	expect(screen.queryByText("/{unique-id}")).toBeNull();
	expect(screen.getByText("The exact path to your existing repository.")).toBeTruthy();

	await userEvent.click(healthCheckCheckbox);
	await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

	await expect.poll(() => submittedBody).toBeDefined();
	expect(submittedBody).toMatchObject({ autoCheckEnabled: true });
	const submittedConfig = submittedBody?.config as Record<string, unknown>;
	expect("autoCheckEnabled" in submittedConfig).toBe(false);
});
