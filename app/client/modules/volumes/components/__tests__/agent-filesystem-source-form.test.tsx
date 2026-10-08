import { afterEach, expect, test, vi } from "vitest";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, waitFor } from "~/test/test-utils";
import type { SourceMachine } from "@zerobyte/contracts/volumes";
import { AgentFilesystemSourceForm, EditAgentFilesystemSourceForm } from "../agent-filesystem-source-form";
import { getFilesystemSourcePresentation } from "../../source-presentation";
import { fromPartial } from "@total-typescript/shoehorn";

const machine: SourceMachine = {
	id: "archive",
	name: "Archive",
	status: "online",
	availability: "available",
	lastSeenAt: 1,
	revokedAt: null,
	trustedRoots: [{ id: "photos", label: "Photos", canBackup: true }],
};
afterEach(cleanup);

test("a selected trusted root produces a folder source", async () => {
	server.use(http.get("/api/v1/volumes/filesystem/browse", () => HttpResponse.json({ path: "", directories: [] })));
	const onSubmit = vi.fn();
	render(
		<>
			<AgentFilesystemSourceForm
				formId="source"
				discovery={{ status: "ready", machines: [machine] }}
				onSubmit={onSubmit}
			/>
			<button type="submit" form="source">
				Save
			</button>
		</>,
	);
	await userEvent.type(screen.getByLabelText("Source name"), "Family archive");
	await userEvent.click(screen.getByLabelText("Remote machine"));
	await userEvent.click(screen.getByRole("option", { name: "Archive · Available" }));
	await userEvent.click(screen.getByLabelText("Allowed location"));
	await userEvent.click(screen.getByRole("option", { name: "Photos" }));
	await userEvent.click(screen.getByLabelText("Folder"));
	await userEvent.click(await screen.findByRole("button", { name: "Select entire location" }));
	expect(screen.getByText("Entire Photos")).toBeTruthy();
	expect(screen.queryByText("/")).toBeNull();
	await userEvent.click(screen.getByText("Save"));
	expect(onSubmit).toHaveBeenCalledWith({
		name: "Family archive",
		sourceKind: "filesystem",
		agentId: "archive",
		trustedRootId: "photos",
		relativePath: "",
	});
});

test("online but unready machines cannot be selected", async () => {
	const unavailable = { ...machine, availability: "not-ready" as const };
	render(<AgentFilesystemSourceForm discovery={{ status: "ready", machines: [unavailable] }} onSubmit={vi.fn()} />);
	await userEvent.click(screen.getByLabelText("Remote machine"));
	expect(screen.getByRole("option", { name: "Archive · Not ready yet" }).getAttribute("aria-disabled")).toBe("true");
});

test("a source cannot be saved without selecting a folder", async () => {
	server.use(http.get("/api/v1/volumes/filesystem/browse", () => HttpResponse.json({ path: "", directories: [] })));
	const onSubmit = vi.fn();
	render(
		<>
			<AgentFilesystemSourceForm
				formId="source"
				discovery={{ status: "ready", machines: [machine] }}
				onSubmit={onSubmit}
			/>
			<button form="source">Save</button>
		</>,
	);
	await userEvent.type(screen.getByLabelText("Source name"), "Family archive");
	await userEvent.click(screen.getByLabelText("Remote machine"));
	await userEvent.click(screen.getByRole("option", { name: "Archive · Available" }));
	await userEvent.click(screen.getByLabelText("Allowed location"));
	await userEvent.click(screen.getByRole("option", { name: "Photos" }));
	await userEvent.click(screen.getByText("Save"));
	expect(onSubmit).not.toHaveBeenCalled();
	expect(screen.getByRole("alert").textContent).toContain("Choose the entire location or a folder");
	const folder = screen.getByLabelText("Folder");
	expect(document.activeElement).toBe(folder);
	expect(folder.getAttribute("aria-invalid")).toBe("true");
	expect(folder.getAttribute("aria-describedby")).toContain(screen.getByRole("alert").id);

	await userEvent.click(folder);
	await userEvent.click(await screen.findByRole("button", { name: "Select entire location" }));
	expect(screen.queryByRole("alert")).toBeNull();
	expect(folder.getAttribute("aria-invalid")).toBe("false");
});

test("rename works while discovery is unavailable without relocating the source", async () => {
	const onRename = vi.fn();
	const presentation = getFilesystemSourcePresentation(
		fromPartial({
			sourceLocation: {
				machine: { name: "Archive" },
				root: { label: "Photos" },
				relativePath: "",
				availability: "offline",
			},
		}),
	);
	render(
		<>
			<EditAgentFilesystemSourceForm
				formId="source"
				initialName="Photos"
				currentLocation={presentation}
				discovery={{ status: "error" }}
				onSubmit={vi.fn()}
				onRename={onRename}
			/>
			<button form="source">Save</button>
		</>,
	);
	await userEvent.clear(screen.getByLabelText("Source name"));
	await userEvent.type(screen.getByLabelText("Source name"), "Archive photos");
	await userEvent.click(screen.getByText("Save"));
	expect(onRename).toHaveBeenCalledWith("Archive photos");
});

test("name and machine validation focus the field and clear after correction", async () => {
	render(
		<>
			<AgentFilesystemSourceForm
				formId="source"
				discovery={{ status: "ready", machines: [machine] }}
				onSubmit={vi.fn()}
			/>
			<button form="source">Save</button>
		</>,
	);

	await userEvent.click(screen.getByText("Save"));
	const name = screen.getByLabelText("Source name");
	expect(document.activeElement).toBe(name);
	expect(name.getAttribute("aria-invalid")).toBe("true");
	expect(name.getAttribute("aria-describedby")).toContain(
		screen.getByText("Name must be between 2 and 32 characters.").id,
	);

	await userEvent.type(name, "Family archive");
	expect(screen.queryByText("Name must be between 2 and 32 characters.")).toBeNull();
	await userEvent.click(screen.getByText("Save"));
	expect(document.activeElement).toBe(screen.getByLabelText("Remote machine"));
	await userEvent.click(screen.getByLabelText("Remote machine"));
	await userEvent.click(screen.getByRole("option", { name: "Archive · Available" }));
	expect(screen.queryByText("Choose an available machine before saving.")).toBeNull();
});

test("unusable locations explain why they are disabled and offer settings and refresh", async () => {
	const refresh = vi.fn();
	const disabledMachine = { ...machine, trustedRoots: [{ id: "photos", label: "Photos", canBackup: false }] };
	render(
		<AgentFilesystemSourceForm
			discovery={{ status: "ready", machines: [disabledMachine], refresh }}
			onSubmit={vi.fn()}
		/>,
	);

	await userEvent.click(screen.getByLabelText("Remote machine"));
	await userEvent.click(screen.getByRole("option", { name: "Archive · Available" }));
	expect(screen.getByText(/Backups are disabled for every allowed location/)).toBeTruthy();
	expect(screen.getByRole("link", { name: /Manage machines/ }).getAttribute("href")).toBe(
		"/settings?scope=organization#machines",
	);
	await userEvent.click(screen.getByRole("button", { name: "Refresh locations" }));
	expect(refresh).toHaveBeenCalledOnce();
	await userEvent.click(screen.getByLabelText("Allowed location"));
	expect(screen.getByRole("option", { name: "Photos · Backups disabled" }).getAttribute("aria-disabled")).toBe(
		"true",
	);
});

test("a machine without shared folders gives the setup command and refresh action", async () => {
	const refresh = vi.fn();
	render(
		<AgentFilesystemSourceForm
			discovery={{ status: "ready", machines: [{ ...machine, trustedRoots: [] }], refresh }}
			onSubmit={vi.fn()}
		/>,
	);

	await userEvent.click(screen.getByLabelText("Remote machine"));
	await userEvent.click(screen.getByRole("option", { name: "Archive · Available" }));
	expect(screen.getByText("sudo zerobyte-agent folders add")).toBeTruthy();
	await userEvent.click(screen.getByRole("button", { name: "Refresh locations" }));
	expect(refresh).toHaveBeenCalledOnce();
});

test("failed selected-folder verification retains the folder, blocks save, and recovers on retry", async () => {
	let folderIsAvailable = false;
	server.use(
		http.get("/api/v1/volumes/filesystem/browse", ({ request }) => {
			const path = new URL(request.url).searchParams.get("path");
			if (path === "")
				return HttpResponse.json({
					path: "",
					directories: [{ name: "albums", path: "albums", type: "directory" }],
				});
			if (!folderIsAvailable) return HttpResponse.json({ message: "/private/files failed" }, { status: 503 });
			return HttpResponse.json({ path: "albums", directories: [] });
		}),
	);
	const onSubmit = vi.fn();
	render(
		<>
			<AgentFilesystemSourceForm
				formId="source"
				discovery={{ status: "ready", machines: [machine] }}
				onSubmit={onSubmit}
			/>
			<button form="source">Save</button>
		</>,
	);

	await userEvent.type(screen.getByLabelText("Source name"), "Family archive");
	await userEvent.click(screen.getByLabelText("Remote machine"));
	await userEvent.click(screen.getByRole("option", { name: "Archive · Available" }));
	await userEvent.click(screen.getByLabelText("Allowed location"));
	await userEvent.click(screen.getByRole("option", { name: "Photos" }));
	await userEvent.click(screen.getByLabelText("Folder"));
	await userEvent.click(await screen.findByRole("button", { name: "albums" }));

	expect(
		await screen.findByText("Could not load folders from this location. Retry or choose another folder."),
	).toBeTruthy();
	expect(screen.getByText("Photos/albums")).toBeTruthy();
	expect(screen.queryByText("No folder selected")).toBeNull();
	expect(document.body.textContent).not.toContain("/private/files");
	await userEvent.click(screen.getByText("Save"));
	expect(onSubmit).not.toHaveBeenCalled();
	expect(document.activeElement).toBe(screen.getByLabelText("Folder"));

	folderIsAvailable = true;
	await userEvent.click(screen.getByRole("button", { name: "Retry loading folder" }));
	await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
	await userEvent.click(screen.getByText("Save"));
	expect(onSubmit).toHaveBeenCalledWith({
		name: "Family archive",
		sourceKind: "filesystem",
		agentId: "archive",
		trustedRootId: "photos",
		relativePath: "albums",
	});
});

test.each(["loading", "error"] as const)(
	"preserves the selected folder draft while discovery is %s",
	async (status) => {
		server.use(
			http.get("/api/v1/volumes/filesystem/browse", ({ request }) => {
				const path = new URL(request.url).searchParams.get("path");
				return HttpResponse.json({
					path: `${path}`,
					directories: path === "" ? [{ name: "albums", path: "albums", type: "directory" }] : [],
				});
			}),
		);
		const onSubmit = vi.fn();
		const ready = { status: "ready" as const, machines: [machine] };
		const form = (discovery: Parameters<typeof AgentFilesystemSourceForm>[0]["discovery"]) => (
			<>
				<AgentFilesystemSourceForm formId="source" discovery={discovery} onSubmit={onSubmit} />
				<button form="source">Save</button>
			</>
		);
		const view = render(form(ready));

		await userEvent.type(screen.getByLabelText("Source name"), "Family archive");
		await userEvent.click(screen.getByLabelText("Remote machine"));
		await userEvent.click(screen.getByRole("option", { name: "Archive · Available" }));
		await userEvent.click(screen.getByLabelText("Allowed location"));
		await userEvent.click(screen.getByRole("option", { name: "Photos" }));
		await userEvent.click(screen.getByLabelText("Folder"));
		await userEvent.click(await screen.findByRole("button", { name: "albums" }));

		view.rerender(form({ status }));
		await userEvent.click(screen.getByText("Save"));
		expect(onSubmit).not.toHaveBeenCalled();

		view.rerender(form(ready));
		expect(await screen.findByText("Photos/albums")).toBeTruthy();
		await waitFor(() => expect(screen.getByLabelText("Folder").getAttribute("aria-invalid")).toBe("false"));
		await userEvent.click(screen.getByText("Save"));
		expect(onSubmit).toHaveBeenCalledWith({
			name: "Family archive",
			sourceKind: "filesystem",
			agentId: "archive",
			trustedRootId: "photos",
			relativePath: "albums",
		});
	},
);

test("machine settings recovery opens a disclosed new tab and retains the form draft", async () => {
	render(
		<AgentFilesystemSourceForm
			discovery={{ status: "ready", machines: [{ ...machine, trustedRoots: [] }], refresh: vi.fn() }}
			onSubmit={vi.fn()}
		/>,
	);
	await userEvent.type(screen.getByLabelText("Source name"), "Family archive");
	await userEvent.click(screen.getByLabelText("Remote machine"));
	await userEvent.click(screen.getByRole("option", { name: "Archive · Available" }));

	const manage = screen.getByRole("link", { name: "Manage machines (opens in new tab)" });
	expect(manage.getAttribute("href")).toBe("/settings?scope=organization#machines");
	expect(manage.getAttribute("target")).toBe("_blank");
	expect(manage.getAttribute("rel")).toContain("noreferrer");
	manage.addEventListener("click", (event) => event.preventDefault());
	await userEvent.click(manage);
	expect((screen.getByLabelText("Source name") as HTMLInputElement).value).toBe("Family archive");
	expect(screen.getByLabelText("Remote machine").textContent).toContain("Archive");
	expect(screen.getByRole("button", { name: "Refresh locations" })).toBeTruthy();
});

test.each(["root-removed", "backup-disabled"] as const)(
	"clears a selected folder when ready discovery confirms %s",
	async (availability) => {
		server.use(
			http.get("/api/v1/volumes/filesystem/browse", ({ request }) => {
				const path = new URL(request.url).searchParams.get("path");
				return HttpResponse.json({
					path: `${path}`,
					directories: path === "" ? [{ name: "albums", path: "albums", type: "directory" }] : [],
				});
			}),
		);
		const onSubmit = vi.fn();
		const form = (machines: SourceMachine[]) => (
			<>
				<AgentFilesystemSourceForm
					formId="source"
					discovery={{ status: "ready", machines }}
					onSubmit={onSubmit}
				/>
				<button form="source">Save</button>
			</>
		);
		const view = render(form([machine]));

		await userEvent.type(screen.getByLabelText("Source name"), "Family archive");
		await userEvent.click(screen.getByLabelText("Remote machine"));
		await userEvent.click(screen.getByRole("option", { name: "Archive · Available" }));
		await userEvent.click(screen.getByLabelText("Allowed location"));
		await userEvent.click(screen.getByRole("option", { name: "Photos" }));
		await userEvent.click(screen.getByLabelText("Folder"));
		await userEvent.click(await screen.findByRole("button", { name: "albums" }));
		expect(screen.getByText("Photos/albums")).toBeTruthy();

		const unavailableMachine: SourceMachine = {
			...machine,
			availability: "available",
			trustedRoots:
				availability === "root-removed"
					? []
					: machine.trustedRoots.map((root) => ({ ...root, canBackup: availability !== "backup-disabled" })),
		};
		view.rerender(form([unavailableMachine]));
		view.rerender(form([machine]));

		expect(await screen.findByText("No folder selected")).toBeTruthy();
		expect(screen.queryByText("Photos/albums")).toBeNull();
		await userEvent.click(screen.getByText("Save"));
		expect(onSubmit).not.toHaveBeenCalled();
		expect(screen.getByText("Choose the entire location or a folder before saving.")).toBeTruthy();
	},
);

test.each(["offline", "connecting", "degraded", "not-ready"] as const)(
	"preserves the folder draft and verifies it again after the machine is %s",
	async (availability) => {
		const browse = vi.fn(({ request }: { request: Request }) => {
			const path = new URL(request.url).searchParams.get("path");
			return HttpResponse.json({
				path: `${path}`,
				directories: path === "" ? [{ name: "albums", path: "albums", type: "directory" }] : [],
			});
		});
		server.use(http.get("/api/v1/volumes/filesystem/browse", browse));
		const onSubmit = vi.fn();
		const refresh = vi.fn();
		const form = (selectedMachine: SourceMachine) => (
			<>
				<AgentFilesystemSourceForm
					formId="source"
					discovery={{
						status: "ready",
						machines: [selectedMachine, { ...machine, id: "spare", name: "Spare" }],
						refresh,
					}}
					onSubmit={onSubmit}
				/>
				<button form="source">Save</button>
			</>
		);
		const view = render(form(machine));

		await userEvent.type(screen.getByLabelText("Source name"), "Family archive");
		await userEvent.click(screen.getByLabelText("Remote machine"));
		await userEvent.click(screen.getByRole("option", { name: "Archive · Available" }));
		await userEvent.click(screen.getByLabelText("Allowed location"));
		await userEvent.click(screen.getByRole("option", { name: "Photos" }));
		await userEvent.click(screen.getByLabelText("Folder"));
		await userEvent.click(await screen.findByRole("button", { name: "albums" }));
		await userEvent.click(screen.getByText("Save"));
		expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ relativePath: "albums" }));
		onSubmit.mockClear();

		view.rerender(form({ ...machine, availability }));
		expect(screen.getByRole("link", { name: "Manage machines (opens in new tab)" })).toBeTruthy();
		await userEvent.click(screen.getByRole("button", { name: "Refresh locations" }));
		expect(refresh).toHaveBeenCalledOnce();
		await userEvent.click(screen.getByText("Save"));
		expect(onSubmit).not.toHaveBeenCalled();
		browse.mockClear();

		view.rerender(form(machine));
		expect(await screen.findByText("Photos/albums")).toBeTruthy();
		await waitFor(() => expect(browse).toHaveBeenCalled());
		await userEvent.click(screen.getByText("Save"));
		expect(onSubmit).toHaveBeenCalledWith({
			name: "Family archive",
			sourceKind: "filesystem",
			agentId: "archive",
			trustedRootId: "photos",
			relativePath: "albums",
		});
	},
);

test("saving without shared folders shows validation and focuses the recovery guidance", async () => {
	const onSubmit = vi.fn();
	render(
		<>
			<AgentFilesystemSourceForm
				formId="source"
				discovery={{ status: "ready", machines: [{ ...machine, trustedRoots: [] }] }}
				onSubmit={onSubmit}
			/>
			<button form="source">Save</button>
		</>,
	);
	await userEvent.type(screen.getByLabelText("Source name"), "Family archive");
	await userEvent.click(screen.getByLabelText("Remote machine"));
	await userEvent.click(screen.getByRole("option", { name: "Archive · Available" }));
	await userEvent.click(screen.getByText("Save"));

	expect(onSubmit).not.toHaveBeenCalled();
	const message = screen.getByText("Choose an allowed location with backups enabled.");
	const recovery = screen.getByText(/No folders shared yet/).closest('[role="alert"]');
	expect(document.activeElement).toBe(recovery);
	expect(recovery?.getAttribute("aria-describedby")).toContain(message.id);
});
