type MachineState = { status: "offline" | "connecting" | "online" | "degraded"; revokedAt: number | null };

export const getMachineStatus = (machine: MachineState) => (machine.revokedAt !== null ? "revoked" : machine.status);

export const machineStatusLabels = {
	online: "Online",
	connecting: "Connecting",
	degraded: "Degraded",
	offline: "Offline",
	revoked: "Revoked",
} as const;

export const isMachineAvailable = (machine: MachineState) => getMachineStatus(machine) === "online";
