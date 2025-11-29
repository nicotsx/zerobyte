import { useMutation } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { restoreSnapshotMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { parseError } from "~/client/lib/errors";
import { Button } from "~/client/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "~/client/components/ui/dialog";
import { ScrollArea } from "~/client/components/ui/scroll-area";
import { RestoreSnapshotForm, type RestoreSnapshotFormValues } from "./restore-snapshot-form";

type Props = {
	name: string;
	snapshotId: string;
};

export const RestoreSnapshotDialog = ({ name, snapshotId }: Props) => {
	const [open, setOpen] = useState(false);
	const formId = useId();

	const restore = useMutation({
		...restoreSnapshotMutation(),
		onSuccess: (data) => {
			toast.success("Snapshot restored successfully", {
				description: `${data.filesRestored} files restored, ${data.filesSkipped} files skipped`,
			});
			setOpen(false);
		},
		onError: (error) => {
			toast.error("Failed to restore snapshot", {
				description: parseError(error)?.message,
			});
		},
	});

	const handleSubmit = (values: RestoreSnapshotFormValues) => {
		const include = values.include
			?.split(",")
			.map((s) => s.trim())
			.filter(Boolean);

		const exclude = values.exclude
			?.split(",")
			.map((s) => s.trim())
			.filter(Boolean);

		const excludeXattr = values.excludeXattr
			?.split(",")
			.map((s) => s.trim())
			.filter(Boolean);

		restore.mutate({
			path: { name },
			body: {
				snapshotId,
				targetPath: values.targetPath || undefined,
				include: include && include.length > 0 ? include : undefined,
				exclude: exclude && exclude.length > 0 ? exclude : undefined,
				excludeXattr: excludeXattr && excludeXattr.length > 0 ? excludeXattr : undefined,
			},
		});
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button>
					<RotateCcw size={16} className="mr-2" />
					Restore
				</Button>
			</DialogTrigger>
			<DialogContent>
				<ScrollArea className="max-h-[600px] p-4">
					<DialogHeader>
						<DialogTitle>Restore Snapshot</DialogTitle>
						<DialogDescription>
							Restore snapshot {snapshotId.substring(0, 8)} to a local filesystem path
						</DialogDescription>
					</DialogHeader>
					<RestoreSnapshotForm className="mt-4" formId={formId} onSubmit={handleSubmit} />
					<DialogFooter className="mt-4">
						<Button type="button" variant="secondary" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button type="submit" form={formId} disabled={restore.isPending}>
							{restore.isPending ? "Restoring..." : "Restore"}
						</Button>
					</DialogFooter>
				</ScrollArea>
			</DialogContent>
		</Dialog>
	);
};
