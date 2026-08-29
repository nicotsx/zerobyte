import { Link } from "@tanstack/react-router";
import { AlertTriangle, X } from "lucide-react";
import { useCookieState } from "~/client/hooks/use-cookie-state";
import { Button, buttonVariants } from "~/client/components/ui/button";
import { Alert, AlertDescription } from "~/client/components/ui/alert";

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60;

type OrganizationRecoveryMaterial = {
	id: string;
	createdAt: Date;
	recoveryMaterialExportedAt: Date | null;
};

type Props = {
	organization: OrganizationRecoveryMaterial;
	canDownloadRecoveryKey: boolean;
};

export function isRecoveryMaterialReminderDue(
	organization: Pick<OrganizationRecoveryMaterial, "createdAt" | "recoveryMaterialExportedAt">,
	now = new Date(),
) {
	const baseline = organization.recoveryMaterialExportedAt ?? organization.createdAt;
	const baselineTime = baseline.getTime();
	const nowTime = now.getTime();

	return nowTime - baselineTime >= ONE_YEAR_MS;
}

const getDismissalCookieName = (organizationId: string) => `recovery_material_reminder_dismissed_${organizationId}`;

export function RecoveryMaterialReminder({ organization, canDownloadRecoveryKey }: Props) {
	const dismissalCookieName = getDismissalCookieName(organization.id);
	const [dismissed, setDismissed] = useCookieState(dismissalCookieName, false, THIRTY_DAYS_IN_SECONDS);
	const reminderDue = isRecoveryMaterialReminderDue(organization);
	const shouldShowReminder = canDownloadRecoveryKey && reminderDue && !dismissed;
	const reviewOptionsClassName = buttonVariants({ size: "sm", variant: "outline" });

	if (!shouldShowReminder) {
		return null;
	}

	return (
		<Alert variant="warning" className="rounded-none border-x-0 border-t-0 px-3 sm:px-8">
			<AlertTriangle className="size-5" />
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<AlertDescription>
					It has been over a year since this organization’s recovery material was exported. Download a fresh
					recovery key and make sure it is stored somewhere safe.
				</AlertDescription>
				<div className="flex shrink-0 items-center gap-2">
					<Link to="/settings" search={{ scope: "organization" }} className={reviewOptionsClassName}>
						Review recovery options
					</Link>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label="Dismiss recovery material reminder"
						onClick={() => setDismissed(true)}
					>
						<X className="size-4" />
					</Button>
				</div>
			</div>
		</Alert>
	);
}
