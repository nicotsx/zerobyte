import { afterEach, expect, test, vi } from "vitest";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, within, waitFor } from "~/test/test-utils";

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
		useNavigate: () => vi.fn(async () => {}),
	};
});

import { CreateBackupPage } from "../create-backup";

const volumeBase = {
	name: "Documents",
	shortId: "source-1",
	status: "mounted",
	config: { backend: "directory", path: "/documents", readOnly: false },
	type: "directory",
	trustedRootId: null,
	relativePath: null,
};

const localVolume = {
	...volumeBase,
	sourceKind: "managed",
	agentId: "local",
	sourceLocation: null,
};

const remoteVolume = {
	...volumeBase,
	name: "Photos",
	shortId: "source-2",
	sourceKind: "filesystem",
	agentId: "remote-machine-id",
	config: null,
	type: null,
	trustedRootId: "photos",
	relativePath: "",
	sourceLocation: {
		machine: { id: "remote-machine-id", name: "Backup NAS", status: "online", lastSeenAt: 1, revokedAt: null },
		root: { id: "photos", label: "Photos", canBackup: true },
		relativePath: "",
		availability: "available",
	},
};

afterEach(cleanup);

test("keeps local choices quiet while remote choices include their machine", async () => {
	server.use(
		http.get("/api/v1/volumes", () => HttpResponse.json([localVolume, remoteVolume])),
		http.get("/api/v1/repositories", () => HttpResponse.json([{ shortId: "repo-1", name: "Archive", type: "s3" }])),
	);

	render(<CreateBackupPage />, { withSuspense: true });
	await userEvent.click(await screen.findByRole("combobox"));

	expect(screen.getByText("Documents")).toBeTruthy();
	expect(screen.getByText("Backup NAS · Photos")).toBeTruthy();
	expect(screen.queryByText("This server")).toBeNull();
});

test("offers repository setup instead of an unusable remote backup form", async () => {
	server.use(
		http.get("/api/v1/volumes", () => HttpResponse.json([remoteVolume])),
		http.get("/api/v1/repositories", () =>
			HttpResponse.json([{ shortId: "repo-1", name: "Archive", type: "local" }]),
		),
	);

	render(<CreateBackupPage />, { withSuspense: true });
	await userEvent.click(await screen.findByRole("combobox"));
	await userEvent.click(screen.getByRole("option", { name: "Backup NAS · Photos" }));

	expect(await screen.findByText("No compatible repository")).toBeTruthy();
	expect(screen.getByRole("link", { name: "Create repository" })).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Create" })).toBeNull();
});

test("changing the source clears paths from the previous machine", async () => {
	server.use(
		http.get("/api/v1/volumes", () => HttpResponse.json([localVolume, remoteVolume])),
		http.get("/api/v1/repositories", () => HttpResponse.json([{ shortId: "repo-1", name: "Archive", type: "s3" }])),
		http.get("/api/v1/volumes/:shortId/files", () =>
			HttpResponse.json({
				files: [{ name: "shared", path: "shared", type: "folder" }],
				offset: 0,
				limit: 100,
				hasMore: false,
			}),
		),
	);

	render(<CreateBackupPage />, { withSuspense: true });
	await userEvent.click(await screen.findByRole("combobox"));
	await userEvent.click(screen.getByRole("option", { name: "Documents" }));
	await userEvent.click(within(await screen.findByRole("button", { name: "shared" })).getByRole("checkbox"));
	expect(screen.getAllByText("/shared").length).toBeGreaterThan(0);

	await userEvent.click(screen.getAllByRole("combobox")[0]!);
	await userEvent.click(screen.getByRole("option", { name: "Backup NAS · Photos" }));
	await waitFor(() => expect(screen.queryByText("/shared")).toBeNull());
	expect(
		within(await screen.findByRole("button", { name: "shared" }))
			.getByRole("checkbox")
			.getAttribute("aria-checked"),
	).toBe("false");
});
