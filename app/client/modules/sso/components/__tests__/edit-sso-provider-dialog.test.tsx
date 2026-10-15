import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, userEvent, waitFor } from "~/test/test-utils";
import { http, HttpResponse, server } from "~/test/msw/server";
import { SsoProviderEditor } from "../edit-sso-provider-dialog";
import type { SsoProviderDetails } from "~/lib/sso-configuration";

const provider: SsoProviderDetails = {
	providerId: "company",
	issuer: "https://identity.example.com/",
	domain: "example.com",
	clientId: "client-id",
	discoveryEndpoint: "https://identity.example.com/.well-known/openid-configuration",
	hasClientSecret: true,
	hasLinkedAccounts: true,
	callbackUrl: "https://backup.example.com/api/auth/sso/callback/company",
	expectedCallbackUrl: null,
	proxyMisconfigured: false,
};

afterEach(cleanup);

function mockDiscovery() {
	server.use(
		http.get("*/api/v1/auth/sso-providers/company/discovery", () =>
			HttpResponse.json({
				discoveryStatus: "issuer_mismatch",
				discoveryIssuer: "https://identity.example.com",
				discoveryMessage: "The issuer must match discovery exactly, including any trailing slash.",
			}),
		),
	);
}

test("offers the exact discovered issuer and saves it while preserving the current secret", async () => {
	const saved: unknown[] = [];
	const onClose = vi.fn();
	server.use(
		http.patch("*/api/v1/auth/sso-providers/company", async ({ request }) => {
			saved.push(await request.json());
			return HttpResponse.json({ success: true });
		}),
	);
	render(<SsoProviderEditor provider={provider} onClose={onClose} />);

	expect(screen.getByLabelText("Client ID").hasAttribute("disabled")).toBe(true);
	expect(screen.getByLabelText("Client Secret")).toHaveProperty("value", "");
	mockDiscovery();
	await userEvent.click(screen.getByRole("button", { name: "Check saved configuration" }));
	await userEvent.click(await screen.findByRole("button", { name: "Use discovered issuer" }));
	expect(screen.getByLabelText("Issuer URL")).toHaveProperty("value", "https://identity.example.com");
	await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

	await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	expect(saved).toEqual([
		{
			issuer: "https://identity.example.com",
		},
	]);
});

test("shows callback diagnostics and keeps a failed save visible for correction", async () => {
	server.use(
		http.patch("*/api/v1/auth/sso-providers/company", () =>
			HttpResponse.json({ message: "Discovery could not confirm the issuer. Try again." }, { status: 400 }),
		),
	);
	render(
		<SsoProviderEditor
			provider={{
				...provider,
				proxyMisconfigured: true,
				callbackUrl: "http://backup.example.com/api/auth/sso/callback/company",
				expectedCallbackUrl: provider.callbackUrl,
			}}
			onClose={() => {}}
		/>,
	);

	expect(screen.getByText("SSO is generating an HTTP callback")).toBeTruthy();
	expect(screen.getByText("TRUST_PROXY=true")).toBeTruthy();
	mockDiscovery();
	await userEvent.click(screen.getByRole("button", { name: "Check saved configuration" }));
	await userEvent.click(await screen.findByRole("button", { name: "Use discovered issuer" }));
	await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

	expect(await screen.findByText("Discovery could not confirm the issuer. Try again.")).toBeTruthy();
	expect(screen.getByLabelText("Issuer URL")).toHaveProperty("value", "https://identity.example.com");
});

test("prevents replacing the issuer of linked accounts", async () => {
	render(<SsoProviderEditor provider={provider} onClose={() => {}} />);
	await userEvent.clear(screen.getByLabelText("Issuer URL"));
	await userEvent.type(screen.getByLabelText("Issuer URL"), "https://different.example.com");

	expect(screen.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(true);
});

test("disables saving when a discovered issuer correction is reverted", async () => {
	const onClose = vi.fn();
	mockDiscovery();
	render(<SsoProviderEditor provider={provider} onClose={onClose} />);

	const save = screen.getByRole("button", { name: "Save changes" });
	expect(save.hasAttribute("disabled")).toBe(true);

	await userEvent.click(screen.getByRole("button", { name: "Check saved configuration" }));
	await userEvent.click(await screen.findByRole("button", { name: "Use discovered issuer" }));
	expect(save.hasAttribute("disabled")).toBe(false);

	await userEvent.type(screen.getByLabelText("Issuer URL"), "/");
	expect(screen.getByLabelText("Issuer URL")).toHaveProperty("value", provider.issuer);
	expect(save.hasAttribute("disabled")).toBe(true);

	await userEvent.click(save);
	expect(onClose).not.toHaveBeenCalled();
});

test("rotates a secret without checking discovery or resending unchanged settings", async () => {
	const saved: unknown[] = [];
	const onClose = vi.fn();
	const discoveryRequest = vi.fn(() => HttpResponse.error());
	server.use(
		http.get("*/api/v1/auth/sso-providers/company/discovery", discoveryRequest),
		http.patch("*/api/v1/auth/sso-providers/company", async ({ request }) => {
			saved.push(await request.json());
			return HttpResponse.json({ success: true });
		}),
	);
	render(<SsoProviderEditor provider={provider} onClose={onClose} />);

	await userEvent.type(screen.getByLabelText("Client Secret"), "replacement-secret");
	await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

	await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	expect(saved).toEqual([{ clientSecret: "replacement-secret" }]);
	expect(discoveryRequest).not.toHaveBeenCalled();
});
