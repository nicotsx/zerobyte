import { useMutation } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { downloadResticPasswordMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { Button } from "~/client/components/ui/button";
import { downloadFile } from "~/client/lib/download";
import { PasswordProtectedActionDialog } from "~/client/modules/settings/components/password-protected-action-dialog";

type Props = {
	hasPassword: boolean;
	passwordAuthSupported: boolean;
};

export function RecoveryKeyDownloadDialog({ hasPassword, passwordAuthSupported }: Props) {
	const download = useMutation(downloadResticPasswordMutation());
	const handleDownload = async (password: string) => {
		const content = await download.mutateAsync({ body: { password } });
		downloadFile({ content, contentType: "text/plain", fileName: "restic.pass" });
		toast.success("Restic password file downloaded successfully");
	};
	const action = {
		title: "Download Recovery Key",
		description: "Download the recovery key file and store it somewhere safe.",
		trigger: (
			<Button variant="outline">
				<Download className="mr-2 size-4" />
				Download recovery key
			</Button>
		),
		submitLabel: "Download",
		submitIcon: <Download className="mr-2 size-4" />,
		isPending: download.isPending,
		failureMessage: "Failed to download Restic password",
		onSubmit: handleDownload,
	};

	return (
		<PasswordProtectedActionDialog
			hasPassword={hasPassword}
			passwordAuthSupported={passwordAuthSupported}
			action={action}
		/>
	);
}
