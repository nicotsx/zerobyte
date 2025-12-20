import { test, describe, expect } from "bun:test";
import { repoMutex } from "../repository-mutex";

describe("RepositoryMutex", () => {
	test("should prioritize waiting exclusive locks over new shared locks", async () => {
		const repoId = "test-repo";
		const results: string[] = [];

		const releaseShared1 = await repoMutex.acquireShared(repoId, "backup-1");
		results.push("acquired-shared-1");

		const exclusivePromise = repoMutex.acquireExclusive(repoId, "unlock").then((release) => {
			results.push("acquired-exclusive");
			return release;
		});

		const shared2Promise = repoMutex.acquireShared(repoId, "backup-2").then((release) => {
			results.push("acquired-shared-2");
			return release;
		});

		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(results).toEqual(["acquired-shared-1"]);

		releaseShared1();

		const releaseExclusive = await exclusivePromise;
		expect(results).toEqual(["acquired-shared-1", "acquired-exclusive"]);

		releaseExclusive();

		const releaseShared2 = await shared2Promise;
		expect(results).toEqual(["acquired-shared-1", "acquired-exclusive", "acquired-shared-2"]);

		releaseShared2();
	});
});
