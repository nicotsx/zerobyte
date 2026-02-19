import { Readable } from "node:stream";
import { Hono } from "hono";
import { validator } from "hono-openapi";
import { streamSSE } from "hono/streaming";
import contentDisposition from "content-disposition";
import {
	createRepositoryBody,
	createRepositoryDto,
	deleteRepositoryDto,
	deleteSnapshotDto,
	deleteSnapshotsBody,
	deleteSnapshotsDto,
	startDoctorDto,
	cancelDoctorDto,
	getRepositoryDto,
	getRepositoryStatsDto,
	getSnapshotDetailsDto,
	refreshSnapshotsDto,
	listRcloneRemotesDto,
	listRepositoriesDto,
	listSnapshotFilesDto,
	listSnapshotFilesQuery,
	listSnapshotsDto,
	listSnapshotsFilters,
	dumpSnapshotDto,
	dumpSnapshotQuery,
	restoreSnapshotBody,
	restoreSnapshotDto,
	tagSnapshotsBody,
	tagSnapshotsDto,
	updateRepositoryBody,
	updateRepositoryDto,
	devPanelExecBody,
	devPanelExecDto,
	unlockRepositoryDto,
	type DeleteRepositoryDto,
	type DeleteSnapshotDto,
	type DeleteSnapshotsResponseDto,
	type StartDoctorDto,
	type CancelDoctorDto,
	type GetRepositoryDto,
	type GetRepositoryStatsDto,
	type GetSnapshotDetailsDto,
	type RefreshSnapshotsDto,
	type ListRepositoriesDto,
	type ListSnapshotFilesDto,
	type ListSnapshotsDto,
	type RestoreSnapshotDto,
	type TagSnapshotsResponseDto,
	type UpdateRepositoryDto,
	type UnlockRepositoryDto,
} from "./repositories.dto";
import { repositoriesService } from "./repositories.service";
import { getRcloneRemoteInfo, listRcloneRemotes } from "../../utils/rclone";
import { requireAuth, requireOrgAdmin } from "../auth/auth.middleware";
import { toMessage } from "~/server/utils/errors";
import { requireDevPanel } from "../auth/dev-panel.middleware";
import { getSnapshotDuration } from "../../utils/snapshots";

export const repositoriesController = new Hono()
	.use(requireAuth)
	.get("/", listRepositoriesDto, async (c) => {
		const repositories = await repositoriesService.listRepositories();

		return c.json<ListRepositoriesDto>(repositories, 200);
	})
	.post("/", createRepositoryDto, validator("json", createRepositoryBody), async (c) => {
		const body = c.req.valid("json");
		const res = await repositoriesService.createRepository(body.name, body.config, body.compressionMode);

		return c.json({ message: "Repository created", repository: res.repository }, 201);
	})
	.get("/rclone-remotes", listRcloneRemotesDto, async (c) => {
		const remoteNames = await listRcloneRemotes();

		const remotes = await Promise.all(
			remoteNames.map(async (name) => {
				const info = await getRcloneRemoteInfo(name);
				return {
					name,
					type: info?.type ?? "unknown",
				};
			}),
		);

		return c.json(remotes);
	})
	.get("/:shortId", getRepositoryDto, async (c) => {
		const { shortId } = c.req.param();
		const res = await repositoriesService.getRepository(shortId);

		return c.json<GetRepositoryDto>(res.repository, 200);
	})
	.get("/:shortId/stats", getRepositoryStatsDto, async (c) => {
		const { shortId } = c.req.param();
		const stats = await repositoriesService.getRepositoryStats(shortId);

		return c.json<GetRepositoryStatsDto>(stats, 200);
	})
	.delete("/:shortId", deleteRepositoryDto, async (c) => {
		const { shortId } = c.req.param();
		await repositoriesService.deleteRepository(shortId);

		return c.json<DeleteRepositoryDto>({ message: "Repository deleted" }, 200);
	})
	.get("/:shortId/snapshots", listSnapshotsDto, validator("query", listSnapshotsFilters), async (c) => {
		const { shortId } = c.req.param();
		const { backupId } = c.req.valid("query");

		const [res, retentionCategories] = await Promise.all([
			repositoriesService.listSnapshots(shortId, backupId),
			repositoriesService.getRetentionCategories(shortId, backupId),
		]);

		const snapshots = res.map((snapshot) => {
			const { summary } = snapshot;

			const duration = getSnapshotDuration(summary);

			return {
				short_id: snapshot.short_id,
				duration,
				paths: snapshot.paths,
				tags: snapshot.tags ?? [],
				size: summary?.total_bytes_processed ?? 0,
				time: new Date(snapshot.time).getTime(),
				retentionCategories: retentionCategories.get(snapshot.short_id) ?? [],
				summary: summary,
			};
		});

		return c.json<ListSnapshotsDto>(snapshots, 200);
	})
	.post("/:shortId/snapshots/refresh", refreshSnapshotsDto, async (c) => {
		const { shortId } = c.req.param();
		const result = await repositoriesService.refreshSnapshots(shortId);

		return c.json<RefreshSnapshotsDto>(result, 200);
	})
	.get("/:shortId/snapshots/:snapshotId", getSnapshotDetailsDto, async (c) => {
		const { shortId, snapshotId } = c.req.param();
		const snapshot = await repositoriesService.getSnapshotDetails(shortId, snapshotId);

		const duration = getSnapshotDuration(snapshot.summary);

		const response = {
			short_id: snapshot.short_id,
			duration,
			time: new Date(snapshot.time).getTime(),
			paths: snapshot.paths,
			hostname: snapshot.hostname,
			size: snapshot.summary?.total_bytes_processed ?? 0,
			tags: snapshot.tags ?? [],
			retentionCategories: [],
			summary: snapshot.summary,
		};

		return c.json<GetSnapshotDetailsDto>(response, 200);
	})
	.get(
		"/:shortId/snapshots/:snapshotId/files",
		listSnapshotFilesDto,
		validator("query", listSnapshotFilesQuery),
		async (c) => {
			const { shortId, snapshotId } = c.req.param();
			const { path, ...query } = c.req.valid("query");

			const decodedPath = path ? decodeURIComponent(path) : undefined;

			const offset = Math.max(0, Number.parseInt(query.offset ?? "0", 10) || 0);
			const limit = Math.min(1000, Math.max(1, Number.parseInt(query.limit ?? "500", 10) || 500));

			const result = await repositoriesService.listSnapshotFiles(shortId, snapshotId, decodedPath, { offset, limit });

			c.header("Cache-Control", "max-age=300, stale-while-revalidate=600");

			return c.json<ListSnapshotFilesDto>(result, 200);
		},
	)
	.get("/:shortId/snapshots/:snapshotId/dump", dumpSnapshotDto, validator("query", dumpSnapshotQuery), async (c) => {
		const { shortId, snapshotId } = c.req.param();
		const { path, kind } = c.req.valid("query");

		const dumpStream = await repositoriesService.dumpSnapshot(shortId, snapshotId, path, kind);
		const signal = c.req.raw.signal;

		if (signal.aborted) {
			dumpStream.abort();
		} else {
			signal.addEventListener("abort", () => dumpStream.abort(), { once: true });
		}

		const webStream = Readable.toWeb(dumpStream.stream) as unknown as ReadableStream<Uint8Array>;

		return new Response(webStream, {
			status: 200,
			headers: {
				"Content-Type": dumpStream.contentType,
				"Content-Disposition": contentDisposition(dumpStream.filename || "snapshot.tar"),
				"X-Content-Type-Options": "nosniff",
			},
		});
	})
	.post("/:shortId/restore", restoreSnapshotDto, validator("json", restoreSnapshotBody), async (c) => {
		const { shortId } = c.req.param();
		const { snapshotId, ...options } = c.req.valid("json");
		const result = await repositoriesService.restoreSnapshot(shortId, snapshotId, options);

		return c.json<RestoreSnapshotDto>(result, 200);
	})
	.post("/:shortId/doctor", startDoctorDto, async (c) => {
		const { shortId } = c.req.param();

		const result = await repositoriesService.startDoctor(shortId);

		return c.json<StartDoctorDto>(result, 202);
	})
	.delete("/:shortId/doctor", cancelDoctorDto, async (c) => {
		const { shortId } = c.req.param();

		const result = await repositoriesService.cancelDoctor(shortId);

		return c.json<CancelDoctorDto>(result, 200);
	})
	.post("/:shortId/unlock", unlockRepositoryDto, async (c) => {
		const { shortId } = c.req.param();

		const result = await repositoriesService.unlockRepository(shortId);

		return c.json<UnlockRepositoryDto>(result, 200);
	})
	.delete("/:shortId/snapshots/:snapshotId", deleteSnapshotDto, async (c) => {
		const { shortId, snapshotId } = c.req.param();
		await repositoriesService.deleteSnapshot(shortId, snapshotId);

		return c.json<DeleteSnapshotDto>({ message: "Snapshot deleted" }, 200);
	})
	.delete("/:shortId/snapshots", deleteSnapshotsDto, validator("json", deleteSnapshotsBody), async (c) => {
		const { shortId } = c.req.param();
		const { snapshotIds } = c.req.valid("json");
		await repositoriesService.deleteSnapshots(shortId, snapshotIds);

		return c.json<DeleteSnapshotsResponseDto>({ message: "Snapshots deleted" }, 200);
	})
	.post("/:shortId/snapshots/tag", tagSnapshotsDto, validator("json", tagSnapshotsBody), async (c) => {
		const { shortId } = c.req.param();
		const { snapshotIds, ...tags } = c.req.valid("json");
		await repositoriesService.tagSnapshots(shortId, snapshotIds, tags);

		return c.json<TagSnapshotsResponseDto>({ message: "Snapshots tagged" }, 200);
	})
	.patch("/:shortId", updateRepositoryDto, validator("json", updateRepositoryBody), async (c) => {
		const { shortId } = c.req.param();
		const body = c.req.valid("json");
		const res = await repositoriesService.updateRepository(shortId, body);

		return c.json<UpdateRepositoryDto>(res.repository, 200);
	})
	.post(
		"/:shortId/exec",
		requireDevPanel,
		requireOrgAdmin,
		devPanelExecDto,
		validator("json", devPanelExecBody),
		async (c) => {
			const { shortId } = c.req.param();
			const body = c.req.valid("json");

			return streamSSE(c, async (stream) => {
				const abortController = new AbortController();
				stream.onAbort(() => abortController.abort());

				const sendSSE = async (event: string, data: unknown) => {
					await stream.writeSSE({ data: JSON.stringify(data), event });
				};

				try {
					const result = await repositoriesService.execResticCommand(
						shortId,
						body.command,
						body.args,
						async (line) => sendSSE("output", { type: "stdout", line }),
						async (line) => sendSSE("output", { type: "stderr", line }),
						abortController.signal,
					);

					await sendSSE("done", { type: "done", exitCode: result.exitCode });
				} catch (error) {
					await sendSSE("error", { type: "error", message: toMessage(error) });
				}
			});
		},
	);
