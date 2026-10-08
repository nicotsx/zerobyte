import { toControllerOrigin } from "@zerobyte/contracts/agent-connection";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { CreateRemoteAgentResponse } from "~/client/api-client/types.gen";
import { Alert, AlertDescription, AlertTitle } from "~/client/components/ui/alert";
import { Button } from "~/client/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/client/components/ui/dialog";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { useTimeFormat } from "~/client/lib/datetime";
import {
	getMachineDisplayName,
	isValidMachineName,
	MACHINE_NAME_MAX_LENGTH,
	normalizeMachineName,
} from "~/lib/machine-name";
import { createConnectionCommand } from "./connection-command";

export type CredentialPresentation = Omit<CreateRemoteAgentResponse, "agent"> & {
	machineName: string;
};

export const presentCredential = ({ agent, ...credential }: CreateRemoteAgentResponse): CredentialPresentation => ({
	...credential,
	machineName: getMachineDisplayName(agent.name),
});

const installationGuide = "https://zerobyte.app/docs/guides/remote-agents";

export function ConnectionRequirements() {
	return (
		<p className="text-pretty text-sm text-muted-foreground">
			Requires Linux x64 or ARM64 with glibc and systemd, sudo access, and Restic 0.18.0 or newer on the service
			PATH.{" "}
			<a href={installationGuide} target="_blank" rel="noreferrer" className="underline underline-offset-4">
				Installation guide
			</a>
		</p>
	);
}

function CopyField({ value }: { value: string }) {
	const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

	const commandRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (copyStatus !== "copied") return;

		const timeout = window.setTimeout(() => setCopyStatus("idle"), 3_000);
		return () => window.clearTimeout(timeout);
	}, [copyStatus]);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(value);
			setCopyStatus("copied");
		} catch {
			setCopyStatus("failed");
			commandRef.current?.focus();
			commandRef.current?.select();
		}
	};

	return (
		<div className="min-w-0 space-y-2">
			<Label htmlFor="machine-connection-command">Connection command</Label>
			<div className="flex min-w-0 items-start gap-2 rounded-md border bg-muted/35 p-2">
				<textarea
					ref={commandRef}
					id="machine-connection-command"
					readOnly
					value={value}
					rows={6}
					className="field-sizing-content min-h-24 min-w-0 flex-1 resize-none break-all bg-transparent py-1 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onFocus={(event) => event.currentTarget.select()}
					onClick={(event) => event.currentTarget.select()}
				/>
				<Button
					type="button"
					variant="outline"
					size="icon"
					className="size-10 shrink-0 transition-transform active:scale-[0.96]"
					aria-label={copyStatus === "copied" ? "Copied connection command" : "Copy connection command"}
					onClick={copy}
				>
					{copyStatus === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
				</Button>
			</div>
			<p
				aria-live="polite"
				aria-atomic="true"
				className={copyStatus === "failed" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
			>
				{copyStatus === "copied" && "Connection command copied."}
				{copyStatus === "failed" &&
					"Could not copy. The command is selected; copy it with Ctrl+C or Command+C."}
			</p>
		</div>
	);
}

export function CredentialDialog({
	credential,
	onClose,
	returnFocusRef,
}: {
	credential: CredentialPresentation | null;
	onClose: () => void;
	returnFocusRef: RefObject<HTMLElement | null>;
}) {
	const { formatDateTime } = useTimeFormat();

	const insecure = credential !== null && toControllerOrigin(credential.controllerUrl).startsWith("http:");

	return (
		<Dialog open={credential !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					returnFocusRef.current?.focus();
				}}
			>
				<DialogHeader>
					<DialogTitle className="min-w-0 [overflow-wrap:anywhere] pr-6 leading-snug">
						Connect {credential?.machineName}
					</DialogTitle>
					<DialogDescription>
						Run this command on this same machine to install or reconnect its agent. Existing Allowed
						locations, permissions, and Sources are preserved.
					</DialogDescription>
				</DialogHeader>

				<div className="min-w-0 space-y-4">
					<ConnectionRequirements />
					{credential && (
						<>
							<p className="text-sm text-muted-foreground">
								Single-use code · expires {formatDateTime(credential.expiresAt)}.
							</p>
							{insecure && (
								<Alert variant="warning">
									<AlertTriangle className="size-4" aria-hidden="true" />
									<AlertTitle>Unencrypted enrollment</AlertTitle>
									<AlertDescription>
										This command sends the enrollment code over unencrypted HTTP and is for
										development controllers only. Production requires HTTPS; behind an HTTPS reverse
										proxy, set <code>TRUST_PROXY=true</code> and use an HTTPS <code>BASE_URL</code>.
									</AlertDescription>
								</Alert>
							)}
							<CopyField
								key={credential.token}
								value={createConnectionCommand(credential.controllerUrl, credential.token)}
							/>
						</>
					)}
					<p className="text-pretty text-sm text-muted-foreground">
						This code is shown only once. After closing, use this machine’s Actions menu to get a fresh
						connection command.
					</p>
					<p className="text-pretty text-sm text-muted-foreground">
						To share more Allowed locations, run <code>sudo zerobyte-agent folders add</code> on the remote
						machine, then create a Source in Zerobyte.
					</p>
				</div>
				<DialogFooter>
					<Button type="button" variant="outline" aria-label="Close connection command" onClick={onClose}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function CreateMachineForm({
	pending,
	failed,
	onCreate,
	onCancel,
}: {
	pending: boolean;
	failed: boolean;
	onCreate: (name: string) => void;
	onCancel: () => void;
}) {
	const [machineName, setMachineName] = useState("");

	const isValid = isValidMachineName(machineName);
	const hasError = machineName.length > 0 && !isValid;

	return (
		<form
			className="space-y-5"
			onSubmit={(event) => {
				event.preventDefault();
				if (isValid) onCreate(normalizeMachineName(machineName));
			}}
		>
			<DialogHeader>
				<DialogTitle>Connect a remote machine</DialogTitle>
				<DialogDescription>
					Name a new machine to install its agent. For an existing installation, close this dialog and use
					that machine’s Actions menu instead.
				</DialogDescription>
			</DialogHeader>
			<div className="space-y-2">
				<Label htmlFor="remote-machine-name">Machine name</Label>
				<Input
					id="remote-machine-name"
					value={machineName}
					onChange={(event) => setMachineName(event.target.value)}
					maxLength={MACHINE_NAME_MAX_LENGTH}
					aria-invalid={hasError}
					aria-describedby={
						hasError ? "remote-machine-name-hint remote-machine-name-error" : "remote-machine-name-hint"
					}
					required
				/>
				<p id="remote-machine-name-hint" className="text-pretty text-xs text-muted-foreground">
					Use a recognizable name such as the host or site.
				</p>
				{hasError && (
					<p id="remote-machine-name-error" role="alert" className="text-pretty text-sm text-destructive">
						Enter a non-empty machine name without invisible control or formatting characters.
					</p>
				)}
			</div>
			<ConnectionRequirements />
			{failed && (
				<p role="alert" className="text-sm text-destructive">
					Could not get the connection command. Check the name and try again.
				</p>
			)}
			<DialogFooter>
				<Button type="button" variant="outline" onClick={onCancel}>
					Cancel
				</Button>
				<Button type="submit" variant="primary" loading={pending} disabled={!isValid}>
					Get connection command
				</Button>
			</DialogFooter>
		</form>
	);
}

export function CreateMachineDialog({
	open,
	onOpenChange,
	...form
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	pending: boolean;
	failed: boolean;
	onCreate: (name: string) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
				<CreateMachineForm {...form} onCancel={() => onOpenChange(false)} />
			</DialogContent>
		</Dialog>
	);
}
