import { afterEach, expect, test, vi } from "vitest";
import { Toaster } from "sonner";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent } from "~/test/test-utils";

afterEach(cleanup);

test.each(["totp", "otp"])("handles the %s enrollment response", async (method) => {
	const { TwoFactorSetupDialog } = await import("../two-factor-setup-dialog");
	server.use(
		http.post("*/api/auth/two-factor/enable", () =>
			HttpResponse.json(
				method === "totp"
					? {
							method,
							totpURI: "otpauth://totp/Zerobyte:test?secret=JBSWY3DPEHPK3PXP&issuer=Zerobyte",
							backupCodes: ["test-backup-code"],
						}
					: { method },
			),
		),
	);
	render(
		<>
			<Toaster />
			<TwoFactorSetupDialog open onOpenChange={vi.fn()} onSuccess={vi.fn()} />
		</>,
	);
	await userEvent.type(screen.getByLabelText("Your password"), "test-password");
	await userEvent.click(screen.getByRole("button", { name: "Continue" }));
	if (method === "totp") {
		expect(await screen.findByRole("heading", { name: "Scan QR Code" })).toBeTruthy();
		expect(screen.getByText("test-backup-code")).toBeTruthy();
	} else {
		expect(await screen.findByText("Failed to enable authenticator setup")).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "Scan QR Code" })).toBeNull();
	}
});
