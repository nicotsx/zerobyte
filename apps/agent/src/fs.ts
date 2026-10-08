import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { toMessage } from "@zerobyte/core/utils";
import { Data, Effect } from "effect";

export class FileSystemError extends Data.TaggedError("FileSystemError")<{ message: string; cause: unknown }> {}

const attempt = <A>(description: string, operation: () => Promise<A>) =>
	Effect.tryPromise({
		try: operation,
		catch: (cause) => new FileSystemError({ message: `Could not ${description}: ${toMessage(cause)}`, cause }),
	});

export const makeDirectory = (path: string, mode?: number) =>
	attempt(`create ${path}`, () => fs.mkdir(path, { recursive: true, mode }));

export const changeMode = (path: string, mode: number) =>
	attempt(`set permissions on ${path}`, () => fs.chmod(path, mode));

export const copy = (from: string, to: string) => attempt(`copy ${from} to ${to}`, () => fs.copyFile(from, to));

export const move = (from: string, to: string) => attempt(`replace ${to}`, () => fs.rename(from, to));

export const realPath = (path: string) => attempt(`resolve ${path}`, () => fs.realpath(path));

export const isDirectory = (path: string) =>
	attempt(`inspect ${path}`, async () => (await fs.stat(path)).isDirectory());

export const exists = (path: string) =>
	Effect.promise(() =>
		fs.access(path).then(
			() => true,
			() => false,
		),
	);

export const writeText = (path: string, contents: string, mode: number) =>
	attempt(`write ${path}`, () => fs.writeFile(path, contents, { mode }));

export const writePrivateFile = (path: string, contents: string) =>
	Effect.acquireUseRelease(
		attempt(`create ${path}`, () => fs.open(path, "wx", 0o600)),
		(file) =>
			attempt(`write ${path}`, async () => {
				await file.writeFile(contents);
				await file.sync();
			}),
		(file) => Effect.promise(() => file.close()),
	);

/** A sibling path that is removed when the scope closes, so an atomic rename onto `target` stays on one filesystem. */
export const stagingPath = (target: string) =>
	Effect.acquireRelease(
		Effect.sync(() => `${target}.${randomUUID()}.tmp`),
		(staged) => attempt(`remove ${staged}`, () => fs.rm(staged, { force: true })).pipe(Effect.ignore),
	);
