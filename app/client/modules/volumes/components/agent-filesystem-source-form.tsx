import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import type { SourceMachine } from "@zerobyte/contracts/volumes";
import { Button } from "~/client/components/ui/button";
import { Input } from "~/client/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Label } from "~/client/components/ui/label";
import { TrustedRootBrowser } from "./trusted-root-browser";
import type { RemoteSourcePresentation } from "../source-presentation";

export type AgentFilesystemFormValues = {
	name: string;
	sourceKind: "agent-filesystem";
	agentId: string;
	trustedRootId: string;
	relativePath: string;
};

export type SourceDiscovery =
	| { status: "loading" }
	| { status: "error"; retry?: () => void }
	| { status: "unsupported" }
	| { status: "ready"; machines: SourceMachine[] };

type Location = { agentId: string; rootId: string; relativePath: string };
type Props = {
	formId?: string;
	discovery: SourceDiscovery;
	loading?: boolean;
	onSubmit: (values: AgentFilesystemFormValues) => void;
};
type EditProps = Props & {
	initialName: string;
	currentLocation: RemoteSourcePresentation;
	onRename: (name: string) => void;
};

function RemoteLocationPicker({
	discovery,
	onChange,
}: {
	discovery: SourceDiscovery;
	onChange: (location: Location | null) => void;
}) {
	const [agentId, setAgentId] = useState("");
	const [rootId, setRootId] = useState("");
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const machines = discovery.status === "ready" ? discovery.machines : [];
	const machine = machines.find((item) => item.id === agentId);
	const root = machine?.trustedRoots.find((item) => item.id === rootId);
	const available = machine?.availability === "available" && root?.canBackup === true;
	const invalidate = useCallback(() => {
		setSelectedPath(null);
		onChange(null);
	}, [onChange]);
	useEffect(() => {
		// oxlint-disable-next-line react/set-state-in-effect -- Availability can change asynchronously and must invalidate a stale selection.
		if (!available) invalidate();
	}, [available, invalidate]);
	const handleVerification = useCallback(
		(verified: boolean) => {
			onChange(verified && selectedPath !== null ? { agentId, rootId, relativePath: selectedPath } : null);
		},
		[agentId, rootId, selectedPath, onChange],
	);
	const fieldId = useId();

	if (discovery.status === "loading") return <p>Loading available machines…</p>;
	if (discovery.status === "unsupported") return <p>Remote source discovery is unavailable in this runtime.</p>;
	if (discovery.status === "error")
		return (
			<div role="alert">
				<p>Available machines could not be loaded.</p>
				{discovery.retry && (
					<Button type="button" variant="outline" onClick={discovery.retry}>
						Retry
					</Button>
				)}
			</div>
		);

	return (
		<div className="space-y-4">
			<div className="space-y-2">
				<Label htmlFor={fieldId}>Remote machine</Label>
				<Select
					value={agentId}
					onValueChange={(value) => {
						setAgentId(value);
						setRootId("");
						invalidate();
					}}
				>
					<SelectTrigger id={fieldId} className="w-full">
						<SelectValue placeholder="Choose a machine" />
					</SelectTrigger>
					<SelectContent>
						{machines.map((item) => (
							<SelectItem key={item.id} value={item.id} disabled={item.availability !== "available"}>
								{item.name} · {item.availability}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{machine && (
				<div className="space-y-2">
					<Label htmlFor={fieldId + "-root"}>Allowed location</Label>
					<Select
						value={rootId}
						disabled={machine.availability !== "available"}
						onValueChange={(value) => {
							setRootId(value);
							invalidate();
						}}
					>
						<SelectTrigger id={fieldId + "-root"} className="w-full">
							<SelectValue placeholder="Choose a folder" />
						</SelectTrigger>
						<SelectContent>
							{machine.trustedRoots.map((item) => (
								<SelectItem key={item.id} value={item.id} disabled={!item.canBackup}>
									{item.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}
			{available && root && (
				<TrustedRootBrowser
					key={agentId + ":" + rootId}
					agentId={agentId}
					rootId={rootId}
					rootLabel={root.label}
					selectedPath={selectedPath}
					onSelect={(relativePath) => {
						setSelectedPath(relativePath);
						onChange(null);
					}}
					onSelectionInvalidated={invalidate}
					onVerificationChange={handleVerification}
				/>
			)}
			{machines.length === 0 && <p>Connect a remote machine in organization settings first.</p>}
			<p className="text-sm text-muted-foreground">
				Only folders allowed on the remote machine can be selected. Network shares must already be mounted
				there.
			</p>
		</div>
	);
}

function SourceForm({ formId, discovery, loading, onSubmit, edit }: Props & { edit?: EditProps }) {
	const generatedId = useId();
	const id = formId ?? generatedId;
	const [name, setName] = useState(edit?.initialName ?? "");
	const [changingLocation, setChangingLocation] = useState(!edit);
	const [location, setLocation] = useState<Location | null>(null);
	const [error, setError] = useState("");
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (loading) return;
		const trimmedName = name.trim();
		if (trimmedName.length < 2 || trimmedName.length > 32) {
			setError("Name must be between 2 and 32 characters.");
			return;
		}
		if (edit && !changingLocation) {
			edit.onRename(trimmedName);
			return;
		}
		const machine =
			discovery.status === "ready" ? discovery.machines.find((item) => item.id === location?.agentId) : undefined;
		const root = machine?.trustedRoots.find((item) => item.id === location?.rootId);
		if (!location || machine?.availability !== "available" || !root?.canBackup) {
			setError("Choose an available machine and select a folder before saving.");
			return;
		}
		onSubmit({
			name: trimmedName,
			sourceKind: "agent-filesystem",
			agentId: location.agentId,
			trustedRootId: location.rootId,
			relativePath: location.relativePath,
		});
	};
	return (
		<form id={id} onSubmit={submit} className="space-y-4">
			<Label htmlFor={id + "-name"}>Source name</Label>
			<Input
				id={id + "-name"}
				value={name}
				onChange={(event) => setName(event.target.value)}
				minLength={2}
				maxLength={32}
				required
				disabled={loading}
			/>
			{edit && (
				<div className="space-y-2">
					<p className="font-medium">Current location</p>
					<p>{edit.currentLocation.context}</p>
					<p className="text-sm text-muted-foreground">{edit.currentLocation.explanation}</p>
					<Button
						type="button"
						variant="outline"
						onClick={() => {
							setChangingLocation(!changingLocation);
							setLocation(null);
							setError("");
						}}
					>
						{changingLocation ? "Keep current location" : "Change location"}
					</Button>
				</div>
			)}
			{changingLocation && <RemoteLocationPicker discovery={discovery} onChange={setLocation} />}
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
		</form>
	);
}

export const AgentFilesystemSourceForm = (props: Props) => <SourceForm {...props} />;
export const EditAgentFilesystemSourceForm = (props: EditProps) => <SourceForm {...props} edit={props} />;
