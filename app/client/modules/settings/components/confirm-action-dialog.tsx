import { useRef, type ReactNode, type RefObject } from "react";
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
	disabled?: boolean;
	error: string | null;
	onConfirm: () => void;
	returnFocusRef: RefObject<HTMLElement | null>;
	getFallbackFocus?: () => HTMLElement | null;
	lockDismissal?: boolean;
	children?: ReactNode;
};

export function ConfirmActionDialog(props: ConfirmActionDialogProps) {
	const cancelRef = useRef<HTMLButtonElement>(null);

	return (
		<AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
			<AlertDialogContent
				onEscapeKeyDown={(event) => {
					if (props.lockDismissal) event.preventDefault();
				}}
				className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					const trigger = props.returnFocusRef.current;
					if (trigger?.isConnected && !trigger.matches(":disabled")) {
						trigger.focus();
					} else {
						props.getFallbackFocus?.()?.focus();
					}
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
					<AlertDialogCancel
						ref={cancelRef}
						aria-disabled={props.lockDismissal}
						className="aria-disabled:opacity-50"
						onClick={(event) => {
							if (props.lockDismissal) event.preventDefault();
						}}
					>
						Cancel
					</AlertDialogCancel>
					<Button
						variant={props.variant}
						loading={props.pending}
						aria-busy={props.pending}
						aria-label={props.confirmLabel}
						disabled={props.disabled}
						onClick={() => {
							cancelRef.current?.focus();
							props.onConfirm();
						}}
					>
						{props.confirmLabel}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
