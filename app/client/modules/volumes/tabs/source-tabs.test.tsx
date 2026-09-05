import { cleanup, render, screen } from "~/test/test-utils";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { PresentedVolume } from "~/client/lib/types";

vi.mock("~/client/components/file-browsers/volume-file-browser", () => ({
	VolumeFileBrowser: (props: { enabled: boolean; requestErrorMessage?: string }) => (
		<div
			data-testid="source-browser"
			data-enabled={String(props.enabled)}
			data-safe-error={props.requestErrorMessage ?? ""}
		/>
	),
}));

import { FilesTabContent } from "./files";
import { VolumeInfoTabContent } from "./info";

const baseVolume = {
	id: 1,
	shortId: "source-1",
	name: "Archive",
	createdAt: 1,
	updatedAt: 1,
	lastHealthCheck: 1,
	status: "mounted" as const,
	lastError: null,
	provisioningId: null,
	autoRemount: true,
};

const managedVolume = {
	...baseVolume,
	path: "/srv/archive",
	config: { backend: "directory", path: "/srv/archive", readOnly: false },
	type: "directory",
	agentId: "local",
	sourceKind: "managed",
	trustedRootId: null,
	relativePath: null,
	sourceLocation: null,
} satisfies PresentedVolume;

type RemoteAvailability = Extract<
	PresentedVolume,
	{ sourceKind: "agent-filesystem" }
>["sourceLocation"]["availability"];

const unavailableCases = [
	["offline", "The machine is offline.", "Bring the machine online"],
	["revoked", "Access to this machine has been revoked.", "Reconnect the machine"],
	["missing-agent", "The linked machine is no longer registered.", "Choose another machine"],
	["root-removed", "The allowed location is no longer shared", "Share the location again"],
] satisfies ReadonlyArray<readonly [RemoteAvailability, string, string]>;

const remoteVolume = (availability: RemoteAvailability, relativePath = "family") => {
	const volume = {
		...baseVolume,
		path: "/",
		config: null,
		type: null,
		agentId: "archive-node-id",
		sourceKind: "agent-filesystem",
		trustedRootId: "photos-id",
		relativePath,
		sourceLocation: {
			machine: {
				id: "archive-node-id",
				name: "Archive node",
				status: availability === "available" ? "online" : "offline",
				lastSeenAt: 1,
				revokedAt: availability === "revoked" ? 1 : null,
			},
			root: { id: "photos-id", label: "Family photos", canBackup: availability === "available" },
			relativePath,
			availability,
		},
	} satisfies PresentedVolume;
	return volume;
};

afterEach(cleanup);

describe("source information", () => {
	test("keeps managed backend configuration and mount guidance", () => {
		const unmountedVolume = { ...managedVolume, status: "unmounted" } satisfies PresentedVolume;
		const view = render(<VolumeInfoTabContent volume={unmountedVolume} statfs={{ total: 0, used: 0, free: 0 }} />);

		expect(screen.getByText("Backend")).toBeTruthy();
		expect(screen.getByText("Directory")).toBeTruthy();
		expect(screen.getByText("/srv/archive")).toBeTruthy();
		expect(view.container.textContent).toContain("Mount the source to see usage.");
	});

	test("shows only safe projected remote location information", () => {
		render(<VolumeInfoTabContent volume={remoteVolume("offline")} statfs={{ total: 0, used: 0, free: 0 }} />);

		expect(screen.getByText("Machine")).toBeTruthy();
		expect(screen.getByText("Archive node")).toBeTruthy();
		expect(screen.getByText("Allowed location")).toBeTruthy();
		expect(screen.getByText("Family photos")).toBeTruthy();
		expect(screen.getByText("family")).toBeTruthy();
		expect(screen.getByText("Unavailable")).toBeTruthy();
		expect(screen.queryByText("Backend")).toBeNull();
		expect(screen.queryByText("archive-node-id")).toBeNull();
		expect(screen.queryByText("photos-id")).toBeNull();
		expect(screen.queryByText(/Mount the source/)).toBeNull();
		expect(screen.queryByText("Storage")).toBeNull();
		expect(screen.queryByText(/storage data/i)).toBeNull();
	});

	test("does not render remote storage usage even when detail data contains values", () => {
		render(<VolumeInfoTabContent volume={remoteVolume("available")} statfs={{ total: 100, used: 40, free: 60 }} />);

		expect(screen.queryByText("Storage")).toBeNull();
		expect(screen.queryByText("Total")).toBeNull();
	});
});

describe("source files", () => {
	test("shows directory recovery guidance when a managed directory is inaccessible", () => {
		const unmountedVolume = { ...managedVolume, status: "unmounted" } satisfies PresentedVolume;
		render(<FilesTabContent volume={unmountedVolume} />);

		expect(screen.getByRole("status").textContent).toContain("Directory is not accessible");
		expect(screen.getByText("Make sure the folder exists and is accessible, then run Check Now.")).toBeTruthy();
		expect(screen.queryByTestId("source-browser")).toBeNull();
	});

	test("browses available remote files with a sanitized request error", () => {
		render(<FilesTabContent volume={remoteVolume("available")} />);

		const browser = screen.getByTestId("source-browser");
		expect(browser.getAttribute("data-enabled")).toBe("true");
		expect(browser.getAttribute("data-safe-error")).toBe(
			"Files could not be loaded. Check the source availability and try again.",
		);
		expect(screen.queryByText(/mount/i)).toBeNull();
	});

	test("blocks browsing after a failed health check despite ready source availability", () => {
		const unhealthyVolume = { ...remoteVolume("available"), status: "error" } satisfies PresentedVolume;
		render(<FilesTabContent volume={unhealthyVolume} />);

		expect(screen.getByRole("status").textContent).toContain("most recent availability check");
		expect(screen.queryByTestId("source-browser")).toBeNull();
	});

	test.each(unavailableCases)(
		"gates %s remote files without mount language",
		(availability, explanation, guidance) => {
			render(<FilesTabContent volume={remoteVolume(availability)} />);

			expect(screen.getByRole("status").textContent).toContain(explanation);
			expect(screen.getByText(new RegExp(guidance))).toBeTruthy();
			expect(screen.queryByText(/mount/i)).toBeNull();
			expect(screen.queryByTestId("source-browser")).toBeNull();
		},
	);
});
