import { readFileSync } from "node:fs";
import os from "node:os";

export const resolveResticHostname = () => {
	if (process.env.RESTIC_HOSTNAME) {
		return process.env.RESTIC_HOSTNAME;
	}

	try {
		const mountinfo = readFileSync("/proc/self/mountinfo", "utf-8");
		const hostnameLine = mountinfo.split("\n").find((line) => line.includes(" /etc/hostname "));

		if (hostnameLine) {
			const hostname = os.hostname();
			const containerIdMatch = hostnameLine.match(/[0-9a-f]{64}/);
			const containerId = containerIdMatch ? containerIdMatch[0] : null;

			if (containerId?.startsWith(hostname)) {
				return "zerobyte";
			}

			return hostname || "zerobyte";
		}
	} catch {}

	return "zerobyte";
};
