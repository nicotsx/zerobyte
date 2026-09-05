import type { PresentedVolume } from "~/client/lib/types";
import type { StatusVariant } from "~/client/components/status-dot";
import { getSafeAllowedLocationLabel, getSafeMachinePresentationLabel } from "~/lib/safe-presentation-label";

type RemoteVolume = Extract<PresentedVolume, { sourceKind: "agent-filesystem" }>;
type SourceLocation = RemoteVolume["sourceLocation"];
type Availability = SourceLocation["availability"];
type RemoteVolumeState = Pick<RemoteVolume, "sourceLocation" | "status">;

export type RemoteSourcePresentation = {
	status: "Available" | "Unavailable" | "Needs attention";
	statusVariant: Exclude<StatusVariant, "info">;
	context: string;
	machine: string;
	location: string;
	logicalFolder: string;
	explanation: string;
	guidance: string;
	isActionable: boolean;
	hasObservedFailure: boolean;
};

const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;
const safeLogicalFolder = (value: string) => {
	const cleanedValue = value.replace(CONTROL_CHARACTERS, "").trim();

	if (!cleanedValue) {
		return "Whole allowed location";
	}

	const segments = cleanedValue.split("/");
	const hasUnsafeSegment = segments.some((segment) => !segment || segment === "." || segment === "..");
	const isUnsafePath = cleanedValue.startsWith("/") || cleanedValue.includes("\\") || hasUnsafeSegment;

	if (isUnsafePath) {
		return "Selected folder";
	}

	return segments.join("/").slice(0, 200);
};

const availabilityCopy: Record<
	Availability,
	Pick<RemoteSourcePresentation, "status" | "statusVariant" | "explanation" | "guidance">
> = {
	available: {
		status: "Available",
		statusVariant: "success",
		explanation: "The machine and allowed location are ready for backups and file browsing.",
		guidance: "Files are ready to browse.",
	},
	revoked: {
		status: "Needs attention",
		statusVariant: "error",
		explanation: "Access to this machine has been revoked.",
		guidance: "Reconnect the machine or choose another machine in source settings.",
	},
	"missing-agent": {
		status: "Needs attention",
		statusVariant: "error",
		explanation: "The linked machine is no longer registered.",
		guidance: "Choose another machine in source settings.",
	},
	incompatible: {
		status: "Needs attention",
		statusVariant: "warning",
		explanation: "The linked machine does not support this source configuration.",
		guidance: "Update or reconnect the machine, then check availability again.",
	},
	"root-removed": {
		status: "Needs attention",
		statusVariant: "error",
		explanation: "The allowed location is no longer shared by the machine.",
		guidance: "Share the location again or choose another allowed location in source settings.",
	},
	"backup-disabled": {
		status: "Needs attention",
		statusVariant: "warning",
		explanation: "Backups are disabled for this allowed location.",
		guidance: "Allow backups for the location or choose another allowed location.",
	},
	"not-ready": {
		status: "Unavailable",
		statusVariant: "neutral",
		explanation: "The machine is online but is not ready to serve this source.",
		guidance: "Wait for the machine to finish connecting, then check availability again.",
	},
	offline: {
		status: "Unavailable",
		statusVariant: "neutral",
		explanation: "The machine is offline.",
		guidance: "Bring the machine online, then check availability again.",
	},
	connecting: {
		status: "Unavailable",
		statusVariant: "neutral",
		explanation: "The machine is connecting.",
		guidance: "Wait for the connection to finish, then check availability again.",
	},
	degraded: {
		status: "Needs attention",
		statusVariant: "warning",
		explanation: "The machine connection is degraded.",
		guidance: "Check the machine connection, then check availability again.",
	},
};

const observedFailureCopy = {
	status: "Needs attention",
	statusVariant: "error",
	explanation: "The source could not be reached during its most recent availability check.",
	guidance: "Check the machine and allowed location, then check availability again.",
} satisfies Pick<RemoteSourcePresentation, "status" | "statusVariant" | "explanation" | "guidance">;

export const isRemoteSourceActionable = (sourceLocation: Pick<SourceLocation, "availability">) =>
	sourceLocation.availability === "available";

export const getRemoteSourcePresentation = (volume: RemoteVolumeState): RemoteSourcePresentation => {
	const sourceLocation = volume.sourceLocation;
	const safeMachineLabel = getSafeMachinePresentationLabel(sourceLocation.machine.name);
	const safeLocationLabel = getSafeAllowedLocationLabel(sourceLocation.root.label);

	const machine = safeMachineLabel.slice(0, 100);
	const location = safeLocationLabel.slice(0, 100);
	const logicalFolder = safeLogicalFolder(sourceLocation.relativePath);

	const locationContext =
		logicalFolder === "Whole allowed location"
			? `${location} (whole allowed location)`
			: `${location}/${logicalFolder}`;
	const context = `${machine} · ${locationContext}`;

	const isActionable = isRemoteSourceActionable(sourceLocation);
	const hasObservedFailure = volume.status === "error";

	const copy =
		isActionable && hasObservedFailure ? observedFailureCopy : availabilityCopy[sourceLocation.availability];

	return { ...copy, context, machine, location, logicalFolder, isActionable, hasObservedFailure };
};
