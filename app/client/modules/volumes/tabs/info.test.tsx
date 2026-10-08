import { fromPartial } from "@total-typescript/shoehorn";
import { afterEach, expect, test } from "vitest";
import type { Volume } from "~/client/lib/types";
import { cleanup, render, screen } from "~/test/test-utils";
import { VolumeInfoTabContent } from "./info";

afterEach(cleanup);

test("filesystem sources display their location without a mount or storage placeholder", () => {
	const volume = fromPartial<Volume>({
		name: "Archive",
		sourceKind: "filesystem",
		type: null,
		config: null,
		sourceLocation: { machine: "NAS", location: "Photos", path: "Photos/family" },
	});
	render(<VolumeInfoTabContent volume={volume} statfs={{ total: 0, used: 0, free: 0 }} />);

	expect(screen.getByText("NAS")).toBeTruthy();
	expect(screen.getByText("Photos/family")).toBeTruthy();
	expect(screen.queryByText("No storage data available.")).toBeNull();
	expect(screen.queryByText("Mount the source to see usage.")).toBeNull();
});
