import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, userEvent } from "~/test/test-utils";
import { http, HttpResponse, server } from "~/test/msw/server";
import { STORED_SECRET } from "~/lib/stored-secret";
import { CreateVolumeForm } from "../create-volume-form";

vi.mock("~/client/hooks/use-system-info", () => ({
	useSystemInfo: () => ({
		runtime: "server",
		capabilities: { volumeBackends: ["smb", "webdav", "sftp"], sysAdmin: true },
	}),
}));

afterEach(cleanup);

test.each([
	{
		backend: "smb" as const,
		server: "nas",
		share: "backups",
		port: 445,
		vers: "3.0" as const,
		mapToContainerUidGid: false,
		password: STORED_SECRET,
	},
	{ backend: "webdav" as const, server: "nas", path: "/backups", port: 443, ssl: true, password: STORED_SECRET },
	{
		backend: "sftp" as const,
		host: "nas",
		username: "backup",
		path: "/backups",
		port: 22,
		password: STORED_SECRET,
		skipHostKeyCheck: false,
		knownHosts: "nas ssh-ed25519 AAAA",
		allowLegacySshRsa: false,
		allowUnsafeSymlinkTargets: false,
	},
])("identifies the existing $backend source when testing stored credentials", async (config) => {
	let submitted: unknown;
	server.use(
		http.post("/api/v1/volumes/test-connection", async ({ request }) => {
			submitted = await request.json();
			return HttpResponse.json({ success: true, message: "Connected" });
		}),
	);

	render(
		<CreateVolumeForm
			mode="update"
			shortId="source-1"
			initialValues={{ name: "Backups", ...config }}
			onSubmit={vi.fn()}
		/>,
	);
	await userEvent.click(screen.getByRole("button", { name: "Test Connection" }));
	await screen.findByText("Connected");
	expect(submitted).toMatchObject({ shortId: "source-1", config });
});
