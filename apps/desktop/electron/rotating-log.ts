import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";

export class RotatingLog {
	private pending = Promise.resolve();
	private bufferedBytes = 0;
	private closed = false;
	private size: number | undefined;

	constructor(
		private readonly file: string,
		private readonly maxBytes = 5 * 1024 * 1024,
		private readonly maxBufferedBytes = 1024 * 1024,
	) {}

	write(line: string) {
		if (this.closed) return;
		const bytes = Buffer.byteLength(line);

		if (this.bufferedBytes + bytes > this.maxBufferedBytes) return;

		this.bufferedBytes += bytes;
		this.pending = this.pending.then(async () => {
			try {
				await this.append(line);
			} catch {
				process.stderr.write("[zerobyte] Unable to write desktop log\n");
			} finally {
				this.bufferedBytes -= bytes;
			}
		});
	}

	private async append(line: string) {
		if (this.size === undefined) {
			await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
			this.size = await stat(this.file).then(
				(info) => info.size,
				() => 0,
			);
		}

		const bytes = Buffer.byteLength(line);
		if (this.size > 0 && this.size + bytes > this.maxBytes) {
			await rename(this.file, `${this.file}.1`);
			this.size = 0;
		}
		await appendFile(this.file, line, { mode: 0o600 });
		this.size += bytes;
	}

	close() {
		this.closed = true;
		return this.pending;
	}
}
