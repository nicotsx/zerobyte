import { toControllerOrigin } from "@zerobyte/contracts/agent-connection";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { CreateRemoteAgentResponse } from "~/client/api-client/types.gen";
import { Alert, AlertDescription, AlertTitle } from "~/client/components/ui/alert";
import { Button } from "~/client/components/ui/button";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { Textarea } from "~/client/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/client/components/ui/tabs";
import { useTimeFormat } from "~/client/lib/datetime";
import {
	getMachineDisplayName,
	isValidMachineName,
	MACHINE_NAME_MAX_LENGTH,
	normalizeMachineName,
} from "~/lib/machine-name";
import { createConnectionCommand } from "./connection-command";
import { createDockerCompose } from "./connection-docker";

const installationGuide = "https://zerobyte.app/docs/guides/remote-agents";

function CopyField({
	value,
	label = "Connection command",
	rows = 6,
	wrap = "soft",
}: {
	value: string;
	label?: string;
	rows?: number;
	wrap?: "soft" | "off";
}) {
	const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

	const fieldId = useId();
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
			<Label htmlFor={fieldId}>{label}</Label>
			<div className="flex min-w-0 items-start gap-2">
				<Textarea
					ref={commandRef}
					id={fieldId}
					readOnly
					value={value}
					rows={rows}
					wrap={wrap}
					className="max-h-80 min-w-0 flex-1 resize-none overflow-auto font-mono text-xs"
					onFocus={(event) => event.currentTarget.select()}
					onClick={(event) => event.currentTarget.select()}
				/>
				<Button
					type="button"
					variant="outline"
					size="icon"
					className="shrink-0"
					aria-label={`${copyStatus === "copied" ? "Copied" : "Copy"} ${label.toLowerCase()}`}
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
				{copyStatus === "copied" && `${label} copied.`}
				{copyStatus === "failed" && "Could not copy. The text is selected; copy it with Ctrl+C or Command+C."}
			</p>
		</div>
	);
}

export function DeploymentInstructions({ credential }: { credential: CreateRemoteAgentResponse }) {
	const { formatDateTime } = useTimeFormat();
	const insecure = toControllerOrigin(credential.controllerUrl).startsWith("http:");

	return (
		<div className="min-w-0 space-y-4">
			{insecure && (
				<Alert variant="warning">
					<AlertTriangle className="size-4" aria-hidden="true" />
					<AlertTitle>Connection isn’t secure</AlertTitle>
					<AlertDescription>
						Credentials and controller traffic will be sent unencrypted. Use HTTPS, or explicitly set
						ZEROBYTE_AGENT_ALLOW_INSECURE_HTTP=true on the controller to allow HTTP connections.
					</AlertDescription>
				</Alert>
			)}
			<Tabs defaultValue="linux" className="min-w-0 gap-4">
				<TabsList aria-label="Deployment method" className="justify-start">
					<TabsTrigger value="linux">Linux installer</TabsTrigger>
					<TabsTrigger value="docker">Docker</TabsTrigger>
				</TabsList>
				<TabsContent value="linux" className="min-w-0 space-y-4">
					<p className="text-sm text-muted-foreground">
						Copy and run this command on {getMachineDisplayName(credential.agent.name)}.
					</p>
					<CopyField value={createConnectionCommand(credential.controllerUrl, credential.token)} />
				</TabsContent>
				<TabsContent value="docker" className="min-w-0 space-y-4">
					<ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
						<li>
							Save this as <code>compose.yaml</code> on {getMachineDisplayName(credential.agent.name)}.
						</li>
						<li>
							Replace <code>/path/on/host</code> with the folder to back up.
						</li>
						<li>
							Run <code>docker compose up -d</code>.
						</li>
					</ol>
					<CopyField
						label="Docker Compose configuration"
						rows={16}
						wrap="off"
						value={createDockerCompose(
							credential.controllerUrl,
							credential.token,
							getMachineDisplayName(credential.agent.name),
						)}
					/>
					<p className="text-sm text-muted-foreground">
						Reconnecting? Update only the connection code in your existing file.
					</p>
				</TabsContent>
			</Tabs>
			<p className="text-sm text-muted-foreground">Keep this page open until your machine connects.</p>
			<p className="text-xs text-muted-foreground">
				Expires {formatDateTime(credential.expiresAt)}.{" "}
				<a href={installationGuide} target="_blank" rel="noreferrer" className="underline underline-offset-4">
					Setup guide
				</a>
			</p>
		</div>
	);
}

export function CreateMachineForm({
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
			className="space-y-4"
			onSubmit={(event) => {
				event.preventDefault();
				if (isValid && !pending) onCreate(normalizeMachineName(machineName));
			}}
		>
			<div className="space-y-2">
				<Label htmlFor="remote-machine-name">Machine name</Label>
				<Input
					id="remote-machine-name"
					value={machineName}
					placeholder="e.g. Archive server"
					disabled={pending}
					onChange={(event) => setMachineName(event.target.value)}
					maxLength={MACHINE_NAME_MAX_LENGTH}
					aria-invalid={hasError}
					aria-describedby={
						hasError ? "remote-machine-name-hint remote-machine-name-error" : "remote-machine-name-hint"
					}
					required
				/>
				<p id="remote-machine-name-hint" className="text-pretty text-xs text-muted-foreground">
					Choose a name you’ll recognize.
				</p>
				{hasError && (
					<p id="remote-machine-name-error" role="alert" className="text-pretty text-sm text-destructive">
						Enter a non-empty machine name without invisible control or formatting characters.
					</p>
				)}
			</div>
			{failed && (
				<p role="alert" className="text-sm text-destructive">
					Could not get the connection command. Check the name and try again.
				</p>
			)}
			<div className="flex justify-end gap-2 pt-4 border-t">
				<Button type="button" variant="secondary" onClick={onCancel}>
					Cancel
				</Button>
				<Button type="submit" loading={pending} disabled={!isValid}>
					Continue
				</Button>
			</div>
		</form>
	);
}
