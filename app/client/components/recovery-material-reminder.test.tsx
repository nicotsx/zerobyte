import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, userEvent } from "~/test/test-utils";

vi.mock("@tanstack/react-start", () => ({
	createIsomorphicFn: () => ({
		server: () => ({
			client: (clientImplementation: unknown) => clientImplementation,
		}),
	}),
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, search, to }: { children: string; search: { scope: string }; to: string }) => (
		<a href={`${to}?scope=${search.scope}`}>{children}</a>
	),
}));

import { isRecoveryMaterialReminderDue, RecoveryMaterialReminder } from "./recovery-material-reminder";

const now = new Date("2026-08-29T00:00:00.000Z");
const oldOrganization = {
	id: "organization-one",
	createdAt: new Date("2025-08-29T00:00:00.000Z"),
	recoveryMaterialExportedAt: null,
};

afterEach(() => {
	cleanup();
	document.cookie = "recovery_material_reminder_dismissed_organization-one=; Path=/; Max-Age=0";
	document.cookie = "recovery_material_reminder_dismissed_organization-two=; Path=/; Max-Age=0";
});

test.each([
	{
		name: "an organization created at least a year ago without an export",
		organization: oldOrganization,
		expected: true,
	},
	{
		name: "a recently created organization without an export",
		organization: { ...oldOrganization, createdAt: new Date("2025-08-30T00:00:00.000Z") },
		expected: false,
	},
	{
		name: "a recent recovery export for an old organization",
		organization: { ...oldOrganization, recoveryMaterialExportedAt: new Date("2026-01-01T00:00:00.000Z") },
		expected: false,
	},
])("reminder is due for $name", ({ organization, expected }) => {
	expect(isRecoveryMaterialReminderDue(organization, now)).toBe(expected);
});

test("only shows the reminder to users who can download recovery keys", () => {
	render(<RecoveryMaterialReminder organization={oldOrganization} canDownloadRecoveryKey={false} />);

	expect(screen.queryByRole("alert")).toBeNull();
});

test("links to organization recovery options and snoozes only the active organization", async () => {
	const firstReminder = render(<RecoveryMaterialReminder organization={oldOrganization} canDownloadRecoveryKey />);

	const reviewOptionsLink = screen.getByRole("link", { name: "Review recovery options" });
	expect(reviewOptionsLink.getAttribute("href")).toBe("/settings?scope=organization");
	await userEvent.click(screen.getByRole("button", { name: "Dismiss recovery material reminder" }));
	expect(screen.queryByRole("alert")).toBeNull();

	firstReminder.unmount();
	render(
		<RecoveryMaterialReminder
			organization={{ ...oldOrganization, id: "organization-two" }}
			canDownloadRecoveryKey
		/>,
	);

	expect(screen.getByRole("alert")).toBeTruthy();
});
