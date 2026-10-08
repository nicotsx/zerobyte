import { afterEach, expect, test, vi } from "vitest";
import type { SourceMachine } from "@zerobyte/contracts/volumes";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, waitFor } from "~/test/test-utils";
import { AgentFilesystemSourceForm } from "../agent-filesystem-source-form";

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	return { ...actual, Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a> };
});

const machine: SourceMachine = {
	id: "archive",
	name: "Archive",
	status: "online",
	lastSeenAt: 1,
	revokedAt: null,
	trustedRoots: [{ id: "photos", label: "Photos", canBackup: true }],
};

const serveMachines = (machines: SourceMachine[]) => {
	server.use(
		http.get("/api/v1/volumes/source-machines", () => HttpResponse.json(machines)),
		http.get("/api/v1/volumes/filesystem/browse", () => HttpResponse.json({ path: "", directories: [] })),
	);
};

const renderForm = (props: Partial<React.ComponentProps<typeof AgentFilesystemSourceForm>> = {}) => {
	const onSubmit = vi.fn();
	render(
		<>
			<AgentFilesystemSourceForm formId="source" onSubmit={onSubmit} {...props} />
			<button type="submit" form="source">
				Save
			</button>
		</>,
	);
	return onSubmit;
};

const chooseLocation = async () => {
	await userEvent.click(await screen.findByLabelText("Machine"));
	await userEvent.click(screen.getByRole("option", { name: "Archive · Online" }));
	await userEvent.click(screen.getByLabelText("Allowed location"));
	await userEvent.click(screen.getByRole("option", { name: "Photos" }));
};

afterEach(cleanup);

test("creates a source for an entire allowed location", async () => {
	serveMachines([machine]);
	const onSubmit = renderForm();

	await userEvent.type(screen.getByLabelText("Name"), "Family archive");
	await chooseLocation();
	await userEvent.click(screen.getByRole("button", { name: "Choose folder" }));
	await userEvent.click(screen.getByRole("button", { name: "Select entire location" }));
	expect(screen.getByText("Entire Photos")).toBeTruthy();

	await userEvent.click(screen.getByText("Save"));

	await waitFor(() =>
		expect(onSubmit.mock.calls[0]?.[0]).toEqual({
			name: "Family archive",
			agentId: "archive",
			trustedRootId: "photos",
			relativePath: "",
		}),
	);
});

test("requires an explicit folder choice", async () => {
	serveMachines([machine]);
	const onSubmit = renderForm();

	await userEvent.type(screen.getByLabelText("Name"), "Family archive");
	await chooseLocation();
	await userEvent.click(screen.getByText("Save"));

	expect(await screen.findByText("Choose the entire location or a folder")).toBeTruthy();
	expect(onSubmit).not.toHaveBeenCalled();
});

test("unavailable machines cannot be chosen", async () => {
	serveMachines([{ ...machine, status: "offline" }]);
	renderForm();

	await userEvent.click(await screen.findByLabelText("Machine"));

	expect(screen.getByRole("option", { name: "Archive · Offline" }).getAttribute("aria-disabled")).toBe("true");
});

test("renames a source without relocating it while machines cannot be loaded", async () => {
	server.use(http.get("/api/v1/volumes/source-machines", () => HttpResponse.json({}, { status: 503 })));
	const onSubmit = renderForm({
		initialValues: { name: "Photos", agentId: "archive", trustedRootId: "photos", relativePath: "albums" },
	});

	expect(await screen.findByText("Machines could not be loaded.")).toBeTruthy();
	await userEvent.clear(screen.getByLabelText("Name"));
	await userEvent.type(screen.getByLabelText("Name"), "Archive photos");
	await userEvent.click(screen.getByText("Save"));

	await waitFor(() =>
		expect(onSubmit.mock.calls[0]?.[0]).toEqual({
			name: "Archive photos",
			agentId: "archive",
			trustedRootId: "photos",
			relativePath: "albums",
		}),
	);
});
