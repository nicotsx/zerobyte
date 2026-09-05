import { afterEach, expect, test, vi } from "vitest";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent } from "~/test/test-utils";

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
	sourceKind: "agent-filesystem",
	agentId: "studio-id",
	config: null,
	type: null,
	trustedRootId: "photos",
	relativePath: "",
	sourceLocation: {
		machine: { id: "studio-id", name: "Studio NAS", status: "online", lastSeenAt: 1, revokedAt: null },
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
	expect(screen.getByText("Studio NAS · Photos")).toBeTruthy();
	expect(screen.queryByText("This server")).toBeNull();
});
