import type { ReactNode, RefObject } from "react";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "~/client/components/ui/alert-dialog";
import { Button } from "~/client/components/ui/button";

export type ConfirmActionDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	confirmLabel: string;
	variant: "primary" | "destructive";
	pending: boolean;
	error: string | null;
	onConfirm: () => void;
	returnFocusRef: RefObject<HTMLElement | null>;
	children?: ReactNode;
};

export function ConfirmActionDialog(props: ConfirmActionDialogProps) {
	return (
		<AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
			<AlertDialogContent
				className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					props.returnFocusRef.current?.focus();
				}}
			>
				<AlertDialogHeader>
					<AlertDialogTitle className="min-w-0 [overflow-wrap:anywhere]">{props.title}</AlertDialogTitle>
					<AlertDialogDescription className="min-w-0 [overflow-wrap:anywhere]">
						{props.description}
					</AlertDialogDescription>
				</AlertDialogHeader>
				{props.children}
				{props.error && (
					<p role="alert" className="text-sm text-destructive">
						{props.error}
					</p>
				)}
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<Button variant={props.variant} loading={props.pending} onClick={props.onConfirm}>
						{props.confirmLabel}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
