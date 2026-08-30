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
	Link: ({
		children,
		hash,
		search,
		to,
	}: {
		children: string;
		hash: string;
		search: { scope: string };
		to: string;
	}) => <a href={`${to}?scope=${search.scope}#${hash}`}>{children}</a>,
}));

import { isRecoveryKeyReminderDue, RecoveryKeyReminder } from "../recovery-key-reminder";

const now = new Date("2026-08-29T00:00:00.000Z");
const oldOrganization = {
	id: "organization-one",
	createdAt: new Date("2025-08-29T00:00:00.000Z"),
	recoveryKeyExportedAt: null,
};

afterEach(() => {
	cleanup();
	document.cookie = "recovery_key_reminder_dismissed_organization-one=; Path=/; Max-Age=0";
	document.cookie = "recovery_key_reminder_dismissed_organization-two=; Path=/; Max-Age=0";
});

test.each([
	{
		name: "an organization created at least a year ago without an export",
		organization: oldOrganization,
		now,
		expected: true,
	},
	{
		name: "a recently created organization without an export",
		organization: { ...oldOrganization, createdAt: new Date("2025-08-30T00:00:00.000Z") },
		now,
		expected: false,
	},
	{
		name: "a recent recovery key export for an old organization",
		organization: { ...oldOrganization, recoveryKeyExportedAt: new Date("2026-01-01T00:00:00.000Z") },
		now,
		expected: false,
	},
	{
		name: "the day before a calendar year that includes leap day",
		organization: { ...oldOrganization, createdAt: new Date("2023-03-01T00:00:00.000Z") },
		now: new Date("2024-02-29T00:00:00.000Z"),
		expected: false,
	},
	{
		name: "the calendar-year anniversary after leap day",
		organization: { ...oldOrganization, createdAt: new Date("2023-03-01T00:00:00.000Z") },
		now: new Date("2024-03-01T00:00:00.000Z"),
		expected: true,
	},
	{
		name: "a calendar year after February 29",
		organization: { ...oldOrganization, createdAt: new Date("2024-02-29T00:00:00.000Z") },
		now: new Date("2025-02-28T00:00:00.000Z"),
		expected: true,
	},
])("reminder is due for $name", ({ organization, now, expected }) => {
	expect(isRecoveryKeyReminderDue(organization, now)).toBe(expected);
});

test("only shows the reminder to users who can download recovery keys", () => {
	render(<RecoveryKeyReminder organization={oldOrganization} canDownloadRecoveryKey={false} />);

	expect(screen.queryByRole("region", { name: "Recovery key reminder" })).toBeNull();
});

test("links to the organization recovery key and snoozes only the active organization", async () => {
	const firstReminder = render(<RecoveryKeyReminder organization={oldOrganization} canDownloadRecoveryKey />);

	const reviewOptionsLink = screen.getByRole("link", { name: "Review recovery key" });
	expect(reviewOptionsLink.getAttribute("href")).toBe("/settings?scope=organization#recovery-key");
	await userEvent.click(screen.getByRole("button", { name: "Dismiss recovery key reminder" }));
	expect(screen.queryByRole("region", { name: "Recovery key reminder" })).toBeNull();

	firstReminder.unmount();
	render(
		<RecoveryKeyReminder organization={{ ...oldOrganization, id: "organization-two" }} canDownloadRecoveryKey />,
	);

	expect(screen.getByRole("region", { name: "Recovery key reminder" })).toBeTruthy();
});
