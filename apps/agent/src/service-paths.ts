import { join } from "node:path";

export const SERVICE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
export const SERVICE_NAME = "zerobyte-agent.service";

export type ServicePaths = { installDir: string; stateDir: string; serviceDir: string };

export const defaultServicePaths: ServicePaths = {
	installDir: "/usr/local/bin",
	stateDir: "/var/lib/zerobyte-agent",
	serviceDir: "/etc/systemd/system",
};

export const SERVICE_CONFIG = join(defaultServicePaths.stateDir, "agent.json");
