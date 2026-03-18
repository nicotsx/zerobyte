import { StatusDot } from "~/client/components/status-dot";

export const BackupStatusDot = ({
	enabled,
	hasError,
	hasWarning,
	isInProgress,
}: {
	enabled: boolean;
	hasError?: boolean;
	hasWarning?: boolean;
	isInProgress?: boolean;
}) => {
	let variant: "success" | "neutral" | "error" | "warning" | "info";
	let label: string;

	if (isInProgress) {
		variant = "info";
		label = "Backup in progress";
	} else if (hasError) {
		variant = "error";
		label = "Error";
	} else if (hasWarning) {
		variant = "warning";
		label = "Warning";
	} else if (enabled) {
		variant = "success";
		label = "Active";
	} else {
		variant = "neutral";
		label = "Paused";
	}

	return <StatusDot variant={variant} label={label} />;
};
