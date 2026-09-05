import { describe, expect, test } from "vitest";
import { getRemoteSourcePresentation } from "./source-presentation";

type RemoteVolumeState = Parameters<typeof getRemoteSourcePresentation>[0];
type SourceLocation = RemoteVolumeState["sourceLocation"];

const availabilityCases = [
	["available", "Available", "success"],
	["offline", "Unavailable", "neutral"],
	["connecting", "Unavailable", "neutral"],
	["not-ready", "Unavailable", "neutral"],
	["degraded", "Needs attention", "warning"],
	["revoked", "Needs attention", "error"],
	["missing-agent", "Needs attention", "error"],
	["incompatible", "Needs attention", "warning"],
	["root-removed", "Needs attention", "error"],
	["backup-disabled", "Needs attention", "warning"],
] satisfies ReadonlyArray<
	readonly [SourceLocation["availability"], string, ReturnType<typeof getRemoteSourcePresentation>["statusVariant"]]
>;

const sourceLocation = (
	availability: SourceLocation["availability"],
	relativePath = "projects/website",
): RemoteVolumeState => {
	const location: SourceLocation = {
		machine: { id: "machine-id", name: "Studio Mac", status: "online", lastSeenAt: 1, revokedAt: null },
		root: { id: "root-id", label: "Work files", canBackup: true },
		relativePath,
		availability,
	};
	return { sourceLocation: location, status: "mounted" };
};

describe("remote source presentation", () => {
	test.each(availabilityCases)(
		"maps %s to an explicit %s status with the %s variant",
		(availability, expectedStatus, expectedVariant) => {
			const presentation = getRemoteSourcePresentation(sourceLocation(availability));

			expect(presentation.status).toBe(expectedStatus);
			expect(presentation.statusVariant).toBe(expectedVariant);
			expect(presentation.explanation.length).toBeGreaterThan(10);
			expect(presentation.guidance.length).toBeGreaterThan(10);
			expect(presentation.isAvailable).toBe(availability === "available");
		},
	);

	test("shows compact context for nested and whole allowed locations", () => {
		const nested = getRemoteSourcePresentation(sourceLocation("available"));
		const wholeLocation = getRemoteSourcePresentation(sourceLocation("available", ""));

		expect(nested.context).toBe("Studio Mac · Work files/projects/website");
		expect(wholeLocation.context).toBe("Studio Mac · Work files (whole allowed location)");
		expect(wholeLocation.logicalFolder).toBe("Whole allowed location");
	});

	test.each([
		["unmounted", "Available"],
		["mounted", "Available"],
	] as const)("keeps a mount-related %s status from blocking a ready source", (status, expected) => {
		const volume = sourceLocation("available");
		volume.status = status;

		const presentation = getRemoteSourcePresentation(volume);

		expect(presentation.status).toBe(expected);
		expect(presentation.isAvailable).toBe(true);
	});

	test("blocks a ready source after an observed failure and recovers after the next successful check", () => {
		const volume = sourceLocation("available");
		volume.status = "error";
		const failedPresentation = getRemoteSourcePresentation(volume);

		expect(failedPresentation.status).toBe("Needs attention");
		expect(failedPresentation.isAvailable).toBe(false);
		expect(failedPresentation.explanation).toContain("most recent availability check");

		volume.status = "mounted";
		const recoveredPresentation = getRemoteSourcePresentation(volume);

		expect(recoveredPresentation.status).toBe("Available");
		expect(recoveredPresentation.isAvailable).toBe(true);
	});

	test.each([
		["offline", "machine is offline"],
		["revoked", "Access to this machine has been revoked"],
		["root-removed", "allowed location is no longer shared"],
	] as const)("preserves the current %s reason when a health check also failed", (availability, explanation) => {
		const volume = sourceLocation(availability);
		volume.status = "error";

		const presentation = getRemoteSourcePresentation(volume);

		expect(presentation.explanation).toContain(explanation);
	});

	test("replaces path-like labels and unsafe logical paths with safe copy", () => {
		const maliciousLocation = sourceLocation("root-removed", "/Users/nicolas/private");
		maliciousLocation.sourceLocation.machine.name = "C:\\Users\\nicolas";
		maliciousLocation.sourceLocation.root.label = "/srv/customer-secrets";
		const presentation = getRemoteSourcePresentation(maliciousLocation);

		expect(presentation.context).toBe("Unnamed machine · Allowed location/Selected folder");
		expect(presentation.context).not.toContain("Users");
		expect(presentation.context).not.toContain("srv");
		expect(presentation.context).not.toContain("machine-id");
		expect(presentation.context).not.toContain("root-id");
	});

	test("uses safe fallbacks when projected labels are blank", () => {
		const missingLabels = sourceLocation("missing-agent", "");
		missingLabels.sourceLocation.machine.name = "\u0000";
		missingLabels.sourceLocation.root.label = "   ";
		const presentation = getRemoteSourcePresentation(missingLabels);

		expect(presentation.context).toBe("Unnamed machine · Allowed location (whole allowed location)");
	});

	test("uses canonical safe-label fallbacks for path-like values", () => {
		const unsafeLabels = sourceLocation("available", "safe/folder");
		unsafeLabels.sourceLocation.machine.name = "~backup";
		unsafeLabels.sourceLocation.root.label = "..";

		const presentation = getRemoteSourcePresentation(unsafeLabels);

		expect(presentation.machine).toBe("Unnamed machine");
		expect(presentation.location).toBe("Allowed location");
		expect(presentation.logicalFolder).toBe("safe/folder");
	});
});
