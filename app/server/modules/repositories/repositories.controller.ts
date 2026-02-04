import { Hono } from "hono";
import { validator } from "hono-openapi";
import { streamSSE } from "hono/streaming";
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
	getSnapshotDetailsDto,
	refreshSnapshotsDto,
	listRcloneRemotesDto,
	listRepositoriesDto,
	listSnapshotFilesDto,
	listSnapshotFilesQuery,
	listSnapshotsDto,
	listSnapshotsFilters,
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
	.get("/:id", getRepositoryDto, async (c) => {
		const { id } = c.req.param();
		const res = await repositoriesService.getRepository(id);

		return c.json<GetRepositoryDto>(res.repository, 200);
	})
	.delete("/:id", deleteRepositoryDto, async (c) => {
		const { id } = c.req.param();
		await repositoriesService.deleteRepository(id);

		return c.json<DeleteRepositoryDto>({ message: "Repository deleted" }, 200);
	})
	.get("/:id/snapshots", listSnapshotsDto, validator("query", listSnapshotsFilters), async (c) => {
		const { id } = c.req.param();
		const { backupId } = c.req.valid("query");

		const [res, retentionCategories] = await Promise.all([
			repositoriesService.listSnapshots(id, backupId),
			repositoriesService.getRetentionCategories(id, backupId),
		]);

		const snapshots = res.map((snapshot) => {
			const { summary } = snapshot;

			let duration = 0;
			if (summary) {
				const { backup_start, backup_end } = summary;
				duration = new Date(backup_end).getTime() - new Date(backup_start).getTime();
			}

			return {
				short_id: snapshot.short_id,
				duration,
				paths: snapshot.paths,
				tags: snapshot.tags ?? [],
				size: summary?.total_bytes_processed || 0,
				time: new Date(snapshot.time).getTime(),
				retentionCategories: retentionCategories.get(snapshot.short_id) ?? [],
			};
		});

		return c.json<ListSnapshotsDto>(snapshots, 200);
	})
	.post("/:id/snapshots/refresh", refreshSnapshotsDto, async (c) => {
		const { id } = c.req.param();
		const result = await repositoriesService.refreshSnapshots(id);

		return c.json<RefreshSnapshotsDto>(result, 200);
	})
	.get("/:id/snapshots/:snapshotId", getSnapshotDetailsDto, async (c) => {
		const { id, snapshotId } = c.req.param();
		const snapshot = await repositoriesService.getSnapshotDetails(id, snapshotId);

		let duration = 0;
		if (snapshot.summary) {
			const { backup_start, backup_end } = snapshot.summary;
			duration = new Date(backup_end).getTime() - new Date(backup_start).getTime();
		}

		const response = {
			short_id: snapshot.short_id,
			duration,
			time: new Date(snapshot.time).getTime(),
			paths: snapshot.paths,
			hostname: snapshot.hostname,
			size: snapshot.summary?.total_bytes_processed || 0,
			tags: snapshot.tags ?? [],
			retentionCategories: [],
			summary: snapshot.summary,
		};

		return c.json<GetSnapshotDetailsDto>(response, 200);
	})
	.get(
		"/:id/snapshots/:snapshotId/files",
		listSnapshotFilesDto,
		validator("query", listSnapshotFilesQuery),
		async (c) => {
			const { id, snapshotId } = c.req.param();
			const { path, ...query } = c.req.valid("query");

			const decodedPath = path ? decodeURIComponent(path) : undefined;

			const offset = Math.max(0, Number.parseInt(query.offset ?? "0", 10) || 0);
			const limit = Math.min(1000, Math.max(1, Number.parseInt(query.limit ?? "500", 10) || 500));

			const result = await repositoriesService.listSnapshotFiles(id, snapshotId, decodedPath, { offset, limit });

			c.header("Cache-Control", "max-age=300, stale-while-revalidate=600");

			return c.json<ListSnapshotFilesDto>(result, 200);
		},
	)
	.post("/:id/restore", restoreSnapshotDto, validator("json", restoreSnapshotBody), async (c) => {
		const { id } = c.req.param();
		const { snapshotId, ...options } = c.req.valid("json");
		const result = await repositoriesService.restoreSnapshot(id, snapshotId, options);

		return c.json<RestoreSnapshotDto>(result, 200);
	})
	.post("/:id/doctor", startDoctorDto, async (c) => {
		const { id } = c.req.param();

		const result = await repositoriesService.startDoctor(id);

		return c.json<StartDoctorDto>(result, 202);
	})
	.delete("/:id/doctor", cancelDoctorDto, async (c) => {
		const { id } = c.req.param();

		const result = await repositoriesService.cancelDoctor(id);

		return c.json<CancelDoctorDto>(result, 200);
	})
	.post("/:id/unlock", unlockRepositoryDto, async (c) => {
		const { id } = c.req.param();

		const result = await repositoriesService.unlockRepository(id);

		return c.json<UnlockRepositoryDto>(result, 200);
	})
	.delete("/:id/snapshots/:snapshotId", deleteSnapshotDto, async (c) => {
		const { id, snapshotId } = c.req.param();
		await repositoriesService.deleteSnapshot(id, snapshotId);

		return c.json<DeleteSnapshotDto>({ message: "Snapshot deleted" }, 200);
	})
	.delete("/:id/snapshots", deleteSnapshotsDto, validator("json", deleteSnapshotsBody), async (c) => {
		const { id } = c.req.param();
		const { snapshotIds } = c.req.valid("json");
		await repositoriesService.deleteSnapshots(id, snapshotIds);

		return c.json<DeleteSnapshotsResponseDto>({ message: "Snapshots deleted" }, 200);
	})
	.post("/:id/snapshots/tag", tagSnapshotsDto, validator("json", tagSnapshotsBody), async (c) => {
		const { id } = c.req.param();
		const { snapshotIds, ...tags } = c.req.valid("json");
		await repositoriesService.tagSnapshots(id, snapshotIds, tags);

		return c.json<TagSnapshotsResponseDto>({ message: "Snapshots tagged" }, 200);
	})
	.patch("/:id", updateRepositoryDto, validator("json", updateRepositoryBody), async (c) => {
		const { id } = c.req.param();
		const body = c.req.valid("json");
		const res = await repositoriesService.updateRepository(id, body);

		return c.json<UpdateRepositoryDto>(res.repository, 200);
	})
	.post(
		"/:id/exec",
		requireDevPanel,
		requireOrgAdmin,
		devPanelExecDto,
		validator("json", devPanelExecBody),
		async (c) => {
			const { id } = c.req.param();
			const body = c.req.valid("json");

			return streamSSE(c, async (stream) => {
				const abortController = new AbortController();
				stream.onAbort(() => abortController.abort());

				const sendSSE = async (event: string, data: unknown) => {
					await stream.writeSSE({ data: JSON.stringify(data), event });
				};

				try {
					const result = await repositoriesService.execResticCommand(
						id,
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
