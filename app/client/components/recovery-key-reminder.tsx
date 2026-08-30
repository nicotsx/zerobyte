import { Link } from "@tanstack/react-router";
import { addYears } from "date-fns";
import { AlertTriangle, X } from "lucide-react";
import { useCookieState } from "~/client/hooks/use-cookie-state";
import { Button, buttonVariants } from "~/client/components/ui/button";
import { Alert, AlertDescription } from "~/client/components/ui/alert";

const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60;

type OrganizationRecoveryKey = {
	id: string;
	createdAt: Date;
	recoveryKeyExportedAt: Date | null;
};

type Props = {
	organization: OrganizationRecoveryKey;
	canDownloadRecoveryKey: boolean;
};

export function isRecoveryKeyReminderDue(
	organization: Pick<OrganizationRecoveryKey, "createdAt" | "recoveryKeyExportedAt">,
	now = new Date(),
) {
	const baseline = organization.recoveryKeyExportedAt ?? organization.createdAt;
	const reminderDate = addYears(baseline, 1);
	const reminderTime = reminderDate.getTime();
	const nowTime = now.getTime();

	return nowTime >= reminderTime;
}

const getDismissalCookieName = (organizationId: string) => `recovery_key_reminder_dismissed_${organizationId}`;

export function RecoveryKeyReminder({ organization, canDownloadRecoveryKey }: Props) {
	const dismissalCookieName = getDismissalCookieName(organization.id);
	const [dismissed, setDismissed] = useCookieState(dismissalCookieName, false, THIRTY_DAYS_IN_SECONDS);
	const reminderDue = isRecoveryKeyReminderDue(organization);
	const shouldShowReminder = canDownloadRecoveryKey && reminderDue && !dismissed;
	const reviewOptionsClassName = buttonVariants({ size: "sm", variant: "outline" });

	if (!shouldShowReminder) {
		return null;
	}

	return (
		<Alert
			variant="warning"
			// oxlint-disable-next-line jsx_a11y/prefer-tag-over-role
			role="region"
			aria-label="Recovery key reminder"
			className="rounded-none border-x-0 border-t-0 px-3 sm:px-8"
		>
			<AlertTriangle className="size-5" />
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<AlertDescription>
					It has been over a year since this organization’s recovery key was exported. Download a fresh copy
					and make sure it is stored somewhere safe.
				</AlertDescription>
				<div className="flex shrink-0 items-center gap-2">
					<Link to="/settings" search={{ scope: "organization" }} className={reviewOptionsClassName}>
						Review recovery key
					</Link>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label="Dismiss recovery key reminder"
						onClick={() => setDismissed(true)}
					>
						<X className="size-4" />
					</Button>
				</div>
			</div>
		</Alert>
	);
}
