import { afterEach, expect, test, vi } from "vitest";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent } from "~/test/test-utils";

const navigateMock = vi.fn(async () => {});

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
	cleanup();
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

	await userEvent.click(healthCheckCheckbox);
	await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

	await expect.poll(() => submittedBody).toBeDefined();
	expect(submittedBody).toMatchObject({ autoCheckEnabled: true });
	const submittedConfig = submittedBody?.config as Record<string, unknown>;
	expect("autoCheckEnabled" in submittedConfig).toBe(false);
});
