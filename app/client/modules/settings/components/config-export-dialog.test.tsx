import { afterEach, expect, test, vi } from "vitest";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, waitFor } from "~/test/test-utils";
import { ConfigExportDialog } from "./config-export-dialog";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

test.each([
	{
		name: "short passphrase",
		exportPassphrase: "too-short",
		exportPassphraseConfirmation: "too-short",
	},
	{
		name: "mismatched passphrases",
		exportPassphrase: "long-enough-export-passphrase",
		exportPassphraseConfirmation: "different-export-passphrase",
	},
])("does not export with a $name", async ({ exportPassphrase, exportPassphraseConfirmation }) => {
	const exportRequests = vi.fn();
	server.use(
		http.post("/api/v1/system/config-export", () => {
			exportRequests();
			return HttpResponse.text("unexpected-export");
		}),
	);

	render(<ConfigExportDialog hasPassword={false} passwordAuthSupported={false} />);

	await userEvent.click(screen.getByRole("button", { name: "Export encrypted config" }));
	expect(screen.getByText(/does not include backup data or volume contents/i)).toBeTruthy();
	await userEvent.type(screen.getByLabelText("Export passphrase"), exportPassphrase);
	await userEvent.type(screen.getByLabelText("Confirm export passphrase"), exportPassphraseConfirmation);
	await userEvent.click(screen.getByRole("button", { name: "Export" }));

	await new Promise((resolve) => window.setTimeout(resolve, 0));
	expect(exportRequests).not.toHaveBeenCalled();
	expect(screen.getByRole("dialog")).toBeTruthy();
});

test("exports and downloads the encrypted configuration, then clears sensitive fields", async () => {
	const encryptedConfig = "zbcfg:v1:encrypted-configuration";
	const accountPassword = "current-account-password";
	const exportPassphrase = "long-enough-export-passphrase";
	let submittedBody: unknown;
	server.use(
		http.post("/api/v1/system/config-export", async ({ request }) => {
			submittedBody = await request.json();
			return HttpResponse.text(encryptedConfig);
		}),
	);
	const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:config-export");
	const clickedAnchors: HTMLAnchorElement[] = [];
	const clickAnchor = vi
		.spyOn(HTMLAnchorElement.prototype, "click")
		.mockImplementation(function (this: HTMLAnchorElement) {
			clickedAnchors.push(this);
		});

	render(<ConfigExportDialog hasPassword passwordAuthSupported />);

	await userEvent.click(screen.getByRole("button", { name: "Export encrypted config" }));
	await userEvent.type(screen.getByLabelText("Your Password"), accountPassword);
	await userEvent.type(screen.getByLabelText("Export passphrase"), exportPassphrase);
	await userEvent.type(screen.getByLabelText("Confirm export passphrase"), exportPassphrase);
	await userEvent.click(screen.getByRole("button", { name: "Export" }));

	await waitFor(() => {
		expect(submittedBody).toEqual({ password: accountPassword, exportPassphrase });
	});
	expect(createObjectUrl).toHaveBeenCalledTimes(1);
	const blob = createObjectUrl.mock.calls[0]?.[0];
	if (!(blob instanceof Blob)) {
		throw new Error("Expected the exported configuration to be downloaded as a Blob");
	}
	expect(blob.type).toBe("text/plain");
	expect(await blob.text()).toBe(encryptedConfig);
	expect(clickAnchor).toHaveBeenCalledTimes(1);
	const anchor = clickedAnchors[0];
	if (!anchor) {
		throw new Error("Expected the exported configuration download link to be clicked");
	}
	expect(anchor.href).toBe("blob:config-export");
	expect(anchor.download).toBe("zerobyte-config.zbex");
	await waitFor(() => {
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	await userEvent.click(screen.getByRole("button", { name: "Export encrypted config" }));
	expect(screen.getByLabelText("Your Password")).toHaveProperty("value", "");
	expect(screen.getByLabelText("Export passphrase")).toHaveProperty("value", "");
	expect(screen.getByLabelText("Confirm export passphrase")).toHaveProperty("value", "");
});
