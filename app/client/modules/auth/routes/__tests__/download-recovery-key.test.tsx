import { afterEach, expect, test, vi } from "vitest";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent } from "~/test/test-utils";

const { mockNavigate } = vi.hoisted(() => ({
	mockNavigate: vi.fn(async () => {}),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();

	return {
		...actual,
		useNavigate: (() => mockNavigate) as typeof actual.useNavigate,
	};
});

import { DownloadRecoveryKeyPage } from "../download-recovery-key";

afterEach(() => {
	mockNavigate.mockClear();
	cleanup();
});

test("shows import warnings until the user acknowledges them", async () => {
	const warning = 'Volume "photos" uses local directory path "/mnt/photos".';
	server.use(
		http.post("/api/v1/system/config-import", () => {
			return HttpResponse.json({
				imported: {
					repositories: 1,
					volumes: 1,
					backupSchedules: 1,
					notificationDestinations: 0,
					backupScheduleMirrors: 0,
					backupScheduleNotifications: 0,
				},
				warnings: [warning],
			});
		}),
	);

	render(<DownloadRecoveryKeyPage passwordAuthSupported hasPassword userId="user-1" runtime="server" />);

	const importLink = screen.getByText("Import configuration");
	const importDetails = importLink.closest("details");
	if (!importDetails) {
		throw new Error("Expected import controls to be inside a disclosure");
	}
	expect(importDetails.open).toBe(false);
	await userEvent.click(importLink);
	expect(importDetails.open).toBe(true);

	const file = new File(["encrypted configuration"], "config.zbex", { type: "text/plain" });
	await userEvent.upload(screen.getByLabelText("Encrypted export file"), file);
	await userEvent.type(screen.getByLabelText("Export passphrase"), "long-enough-export-passphrase");
	await userEvent.click(screen.getByRole("button", { name: "Import" }));

	expect(await screen.findByRole("heading", { name: "Configuration imported" })).toBeTruthy();
	expect(screen.getByText(/not backup data/i)).toBeTruthy();
	expect(screen.getByText(warning)).toBeTruthy();
	expect(mockNavigate).not.toHaveBeenCalled();

	await userEvent.click(screen.getByRole("button", { name: "I understand, continue" }));
	expect(mockNavigate).toHaveBeenCalledWith({ to: "/volumes", replace: true });
});
