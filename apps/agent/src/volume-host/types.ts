export type BackendStatus = "mounted" | "unmounted" | "error";

type BaseConfig = { backend: string; readOnly?: boolean };

export type BackendConfig =
	| (BaseConfig & { backend: "directory"; path: string })
	| (BaseConfig & { backend: "nfs"; server: string; exportPath: string; port: number; version: "3" | "4" | "4.1" })
	| (BaseConfig & {
			backend: "smb";
			server: string;
			share: string;
			username?: string;
			password?: string;
			guest?: boolean;
			vers?: "1.0" | "2.0" | "2.1" | "3.0" | "auto";
			domain?: string;
			port: number;
	  })
	| (BaseConfig & {
			backend: "webdav";
			server: string;
			path: string;
			username?: string;
			password?: string;
			port: number;
			ssl?: boolean;
	  })
	| (BaseConfig & { backend: "rclone"; remote: string; path: string })
	| (BaseConfig & {
			backend: "sftp";
			host: string;
			port: number;
			username: string;
			password?: string;
			privateKey?: string;
			path: string;
			skipHostKeyCheck?: boolean;
			knownHosts?: string;
	  });

export type AgentVolume = {
	id: number;
	shortId: string;
	name: string;
	config: BackendConfig;
	createdAt: number;
	updatedAt: number;
	lastHealthCheck: number;
	type: string;
	status: BackendStatus;
	lastError: string | null;
	provisioningId?: string | null;
	autoRemount: boolean;
	agentId: string;
	organizationId: string;
};

export type OperationResult = {
	status: BackendStatus;
	error?: string;
};

export type VolumeBackend = {
	mount: () => Promise<OperationResult>;
	unmount: () => Promise<OperationResult>;
	checkHealth: () => Promise<OperationResult>;
};
