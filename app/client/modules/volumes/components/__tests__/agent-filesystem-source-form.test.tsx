import { afterEach, expect, test, vi } from "vitest";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent } from "~/test/test-utils";
import type { SourceMachine } from "@zerobyte/contracts/volumes";
import { AgentFilesystemSourceForm, EditAgentFilesystemSourceForm } from "../agent-filesystem-source-form";
import { getRemoteSourcePresentation } from "../../source-presentation";
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
	server.use(
		http.get("/api/v1/volumes/filesystem/browse", () =>
			HttpResponse.json({ path: "trusted-root:", directories: [] }),
		),
	);
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
	await userEvent.click(screen.getByRole("option", { name: "Archive · available" }));
	await userEvent.click(screen.getByLabelText("Allowed location"));
	await userEvent.click(screen.getByRole("option", { name: "Photos" }));
	await userEvent.click(screen.getByRole("button", { name: "Change" }));
	await userEvent.click(await screen.findByRole("button", { name: "Select entire location" }));
	await userEvent.click(screen.getByText("Save"));
	expect(onSubmit).toHaveBeenCalledWith({
		name: "Family archive",
		sourceKind: "agent-filesystem",
		agentId: "archive",
		trustedRootId: "photos",
		relativePath: "",
	});
});

test("online but unready machines cannot be selected", async () => {
	const unavailable = { ...machine, availability: "not-ready" as const };
	render(<AgentFilesystemSourceForm discovery={{ status: "ready", machines: [unavailable] }} onSubmit={vi.fn()} />);
	await userEvent.click(screen.getByLabelText("Remote machine"));
	expect(screen.getByRole("option", { name: "Archive · not-ready" }).getAttribute("aria-disabled")).toBe("true");
});

test("a source cannot be saved without selecting a folder", async () => {
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
	await userEvent.click(screen.getByText("Save"));
	expect(onSubmit).not.toHaveBeenCalled();
	expect(screen.getByRole("alert").textContent).toContain("select a folder");
});

test("rename works while discovery is unavailable without relocating the source", async () => {
	const onRename = vi.fn();
	const presentation = getRemoteSourcePresentation(
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
