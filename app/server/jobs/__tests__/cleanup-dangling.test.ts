import { afterEach, expect, test, vi } from "vitest";
import { config } from "../../core/config";
import { CleanupDanglingMountsJob } from "../cleanup-dangling";
import * as mountinfo from "../../utils/mountinfo";

afterEach(() => {
	config.flags.enableLocalAgent = true;
	vi.restoreAllMocks();
});

test("skips controller-local mount inspection when local volume execution is agent-owned", async () => {
	config.flags.enableLocalAgent = true;
	const readMountInfo = vi.spyOn(mountinfo, "readMountInfo");

	await new CleanupDanglingMountsJob().run();

	expect(readMountInfo).not.toHaveBeenCalled();
});
