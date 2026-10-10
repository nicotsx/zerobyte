import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { ExternalLink } from "lucide-react";
import type { SourceMachine } from "@zerobyte/contracts/volumes";
import { Button } from "~/client/components/ui/button";
import { Input } from "~/client/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Label } from "~/client/components/ui/label";
import { Alert, AlertDescription } from "~/client/components/ui/alert";
import { TrustedRootBrowser } from "./trusted-root-browser";
import type { FilesystemSourcePresentation } from "../source-presentation";

export type AgentFilesystemFormValues = {
	name: string;
	sourceKind: "filesystem";
	agentId: string;
	trustedRootId: string;
	relativePath: string;
};

export type SourceDiscovery =
	| { status: "loading" }
	| { status: "error"; retry?: () => void }
	| { status: "unsupported" }
	| { status: "ready"; machines: SourceMachine[]; refresh?: () => void };

type Location = { agentId: string; rootId: string; relativePath: string };
type LocationDraft = { agentId: string; rootId: string; selectedPath: string | null };
type FieldErrors = Partial<Record<"name" | "machine" | "root" | "folder", string>>;

type Props = {
	formId?: string;
	discovery: SourceDiscovery;
	loading?: boolean;
	active?: boolean;
	name?: string;
	onNameChange?: (name: string) => void;
	onSubmit: (values: AgentFilesystemFormValues) => void;
};

type EditProps = Props & {
	initialName: string;
	currentLocation: FilesystemSourcePresentation;
	onRename: (name: string) => void;
};

const machineAvailabilityLabels: Record<SourceMachine["availability"], string> = {
	disabled: "Remote agents disabled",
	available: "Available",
	offline: "Offline",
	connecting: "Connecting",
	degraded: "Connection needs attention",
	revoked: "Access revoked",
	"missing-agent": "Machine no longer registered",
	"root-removed": "Allowed location no longer shared",
	incompatible: "Agent update required",
	"backup-disabled": "Backups disabled",
	"not-ready": "Not ready yet",
};

function FieldError({ id, message }: { id: string; message?: string }) {
	if (!message) return null;

	return (
		<p id={id} role="alert" data-slot="form-message" className="text-sm text-destructive">
			{message}
		</p>
	);
}

function RemoteLocationPicker({
	id,
	discovery,
	active,
	errors,
	onChange,
	onDraftChange,
	onFieldChange,
}: {
	id: string;
	discovery: SourceDiscovery;
	active: boolean;
	errors: FieldErrors;
	onChange: (location: Location | null) => void;
	onDraftChange: (draft: LocationDraft) => void;
	onFieldChange: (field: "machine" | "root" | "folder") => void;
}) {
	const [agentId, setAgentId] = useState("");
	const [rootId, setRootId] = useState("");
	const [selectedPath, setSelectedPath] = useState<string | null>(null);

	const machines = discovery.status === "ready" ? discovery.machines : [];
	const machine = machines.find((item) => item.id === agentId);
	const root = machine?.trustedRoots.find((item) => item.id === rootId);
	const available = machine?.availability === "available" && root?.canBackup === true;
	const temporarilyUnavailable =
		root?.canBackup === true &&
		(machine?.availability === "offline" ||
			machine?.availability === "connecting" ||
			machine?.availability === "degraded" ||
			machine?.availability === "not-ready");
	const hasAvailableMachines = machines.some((item) => item.availability === "available");
	const hasAvailableRoots = machine?.trustedRoots.some((item) => item.canBackup);
	const selectedMachineUnavailable = !!machine && machine.availability !== "available";

	const machineError = machine?.availability === "available" ? undefined : errors.machine;
	const rootError = root?.canBackup ? undefined : errors.root;

	const invalidate = useCallback(() => {
		setSelectedPath(null);
		onChange(null);
	}, [onChange]);

	useEffect(() => {
		if (discovery.status === "loading" || discovery.status === "error" || temporarilyUnavailable) {
			onChange(null);
			return;
		}

		// oxlint-disable-next-line react/set-state-in-effect
		if (!available) invalidate();
	}, [discovery.status, available, temporarilyUnavailable, invalidate, onChange]);

	useEffect(() => {
		onDraftChange({ agentId, rootId, selectedPath });
	}, [agentId, rootId, selectedPath, onDraftChange]);

	const handleVerification = useCallback(
		(verified: boolean) => {
			onChange(verified && selectedPath !== null ? { agentId, rootId, relativePath: selectedPath } : null);
		},
		[agentId, rootId, selectedPath, onChange],
	);

	if (discovery.status !== "ready") {
		return (
			<Alert
				id={id + "-machine"}
				tabIndex={-1}
				aria-invalid={!!errors.machine}
				aria-describedby={errors.machine ? id + "-machine-error" : undefined}
				variant={discovery.status === "error" ? "destructive" : "default"}
			>
				<AlertDescription className="space-y-2">
					<p>
						{discovery.status === "loading"
							? "Loading available machines…"
							: discovery.status === "unsupported"
								? "Remote source discovery is unavailable in this runtime."
								: "Available machines could not be loaded."}
					</p>
					<FieldError id={id + "-machine-error"} message={errors.machine} />
					{discovery.status === "error" && discovery.retry && (
						<Button type="button" variant="outline" size="sm" onClick={discovery.retry}>
							Retry
						</Button>
					)}
				</AlertDescription>
			</Alert>
		);
	}

	return (
		<div className="space-y-4">
			<div className="min-w-0 grid gap-2">
				<Label htmlFor={id + "-machine"}>Remote machine</Label>
				<Select
					value={agentId}
					onValueChange={(value) => {
						setAgentId(value);
						setRootId("");
						invalidate();
						onFieldChange("machine");
					}}
				>
					<SelectTrigger
						id={id + "-machine"}
						className="min-w-0 w-full"
						aria-invalid={!!machineError}
						aria-describedby={machineError ? id + "-machine-error" : undefined}
					>
						<SelectValue className="min-w-0 flex-1" placeholder="Choose a machine">
							{machine && (
								<span
									className="min-w-0 truncate"
									title={`${machine.name} · ${machineAvailabilityLabels[machine.availability]}`}
								>
									{machine.name} · {machineAvailabilityLabels[machine.availability]}
								</span>
							)}
						</SelectValue>
					</SelectTrigger>
					<SelectContent className="w-(--radix-select-trigger-width) max-w-[calc(100vw-2rem)]">
						{machines.map((item) => (
							<SelectItem
								key={item.id}
								value={item.id}
								disabled={item.availability !== "available"}
								className="min-w-0 whitespace-normal [overflow-wrap:anywhere]"
							>
								{item.name} · {machineAvailabilityLabels[item.availability]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<FieldError id={id + "-machine-error"} message={machineError} />
			</div>

			{machine && machine.trustedRoots.length > 0 && (
				<div className="min-w-0 grid gap-2">
					<Label htmlFor={id + "-root"}>Allowed location</Label>
					<Select
						value={rootId}
						disabled={machine.availability !== "available"}
						onValueChange={(value) => {
							setRootId(value);
							invalidate();
							onFieldChange("root");
						}}
					>
						<SelectTrigger
							id={id + "-root"}
							className="min-w-0 w-full"
							aria-invalid={!!rootError}
							aria-describedby={rootError ? id + "-root-error" : undefined}
						>
							<SelectValue className="min-w-0 flex-1" placeholder="Choose an allowed location">
								{root && (
									<span className="min-w-0 truncate" title={root.label}>
										{root.label}
									</span>
								)}
							</SelectValue>
						</SelectTrigger>
						<SelectContent className="w-(--radix-select-trigger-width) max-w-[calc(100vw-2rem)]">
							{machine.trustedRoots.map((item) => (
								<SelectItem
									key={item.id}
									value={item.id}
									disabled={!item.canBackup}
									className="min-w-0 whitespace-normal [overflow-wrap:anywhere]"
								>
									{item.label}
									{!item.canBackup && " · Backups disabled"}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<FieldError id={id + "-root-error"} message={rootError} />
				</div>
			)}

			{(!hasAvailableMachines || selectedMachineUnavailable || (machine && !hasAvailableRoots)) && (
				<Alert
					id={machine?.trustedRoots.length === 0 ? id + "-root" : undefined}
					tabIndex={machine?.trustedRoots.length === 0 ? -1 : undefined}
					aria-describedby={machine?.trustedRoots.length === 0 && rootError ? id + "-root-error" : undefined}
				>
					<AlertDescription className="space-y-2">
						<p className="[overflow-wrap:anywhere]">
							{machines.length === 0 ? (
								"Connect a remote machine in organization settings first."
							) : selectedMachineUnavailable ? (
								"This machine is unavailable for backups. Bring it online or resolve its connection status, then refresh locations or choose another machine."
							) : !hasAvailableMachines ? (
								"No machines are available for backups. Bring a machine online or resolve its connection status."
							) : machine?.trustedRoots.length === 0 ? (
								<>No folders shared yet. Share a folder on {machine.name}, then refresh.</>
							) : (
								"Backups are disabled for every allowed location on this machine. Allow backups for a location or choose another machine."
							)}
						</p>
						{machine?.trustedRoots.length === 0 && (
							<FieldError id={id + "-root-error"} message={rootError} />
						)}
						<div className="flex flex-wrap items-center gap-3">
							<a
								className="inline-flex items-center gap-1 underline underline-offset-4"
								href="/settings?scope=organization#machines"
								target="_blank"
								rel="noreferrer"
							>
								Manage machines
								<ExternalLink className="size-3.5" aria-hidden="true" />
								<span className="sr-only"> (opens in new tab)</span>
							</a>
							{discovery.refresh && (
								<Button type="button" variant="outline" size="sm" onClick={discovery.refresh}>
									Refresh locations
								</Button>
							)}
						</div>
					</AlertDescription>
				</Alert>
			)}

			{available && root && (
				<TrustedRootBrowser
					key={agentId + ":" + rootId}
					id={id + "-folder"}
					agentId={agentId}
					rootId={rootId}
					rootLabel={root.label}
					selectedPath={selectedPath}
					active={active}
					error={errors.folder}
					onSelect={(relativePath) => {
						setSelectedPath(relativePath);
						onChange(null);
						onFieldChange("folder");
					}}
					onVerificationChange={handleVerification}
				/>
			)}

			<p className="text-xs text-muted-foreground">
				Only folders allowed on the remote machine can be selected. Network shares must already be mounted
				there.
			</p>
		</div>
	);
}

function SourceForm({
	formId,
	discovery,
	loading,
	onSubmit,
	active = true,
	name: sharedName,
	onNameChange,
	edit,
}: Props & { edit?: EditProps }) {
	const generatedId = useId();
	const id = formId ?? generatedId;

	const [localName, setLocalName] = useState(edit?.initialName ?? "");

	const [changingLocation, setChangingLocation] = useState(!edit);
	const [location, setLocation] = useState<Location | null>(null);
	const [draft, setDraft] = useState<LocationDraft>({ agentId: "", rootId: "", selectedPath: null });

	const [errors, setErrors] = useState<FieldErrors>({});

	const name = sharedName ?? localName;
	const nameError = name.trim().length >= 2 && name.trim().length <= 32 ? undefined : errors.name;

	const clearLocationErrors = useCallback((field: "machine" | "root" | "folder") => {
		setErrors((current) => ({
			...current,
			...(field === "machine"
				? { machine: undefined, root: undefined, folder: undefined }
				: field === "root"
					? { root: undefined, folder: undefined }
					: { folder: undefined }),
		}));
	}, []);

	const handleLocationChange = useCallback((next: Location | null) => {
		setLocation(next);
		if (next) setErrors((current) => ({ ...current, folder: undefined }));
	}, []);

	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (loading || !active) return;

		const trimmedName = name.trim();
		const nextErrors: FieldErrors = {};

		if (trimmedName.length < 2 || trimmedName.length > 32)
			nextErrors.name = "Name must be between 2 and 32 characters.";

		if (changingLocation) {
			const machine =
				discovery.status === "ready" ? discovery.machines.find((item) => item.id === draft.agentId) : undefined;
			const root = machine?.trustedRoots.find((item) => item.id === draft.rootId);

			if (!machine || machine.availability !== "available")
				nextErrors.machine = "Choose an available machine before saving.";
			else if (!root?.canBackup) nextErrors.root = "Choose an allowed location with backups enabled.";
			else if (draft.selectedPath === null)
				nextErrors.folder = "Choose the entire location or a folder before saving.";
			else if (!location)
				nextErrors.folder =
					"The selected folder must be verified before saving. Retry loading it or choose another folder.";
		}

		setErrors(nextErrors);

		const firstError = (["name", "machine", "root", "folder"] as const).find((field) => nextErrors[field]);

		if (firstError) {
			const control = document.getElementById(`${id}-${firstError}`);
			control?.focus();
			control?.scrollIntoView?.({ behavior: "smooth", block: "center" });
			return;
		}

		if (edit && !changingLocation) {
			edit.onRename(trimmedName);
			return;
		}

		if (!location) return;

		onSubmit({
			name: trimmedName,
			sourceKind: "filesystem",
			agentId: location.agentId,
			trustedRootId: location.rootId,
			relativePath: location.relativePath,
		});
	};

	return (
		<form id={id} noValidate onSubmit={submit} className="space-y-4">
			<div className="grid gap-2" data-slot="form-item">
				<Label htmlFor={id + "-name"}>Source name</Label>
				<Input
					id={id + "-name"}
					value={name}
					onChange={(event) => {
						setLocalName(event.target.value);
						onNameChange?.(event.target.value);
						setErrors((current) => ({ ...current, name: undefined }));
					}}
					placeholder="Source name"
					minLength={2}
					maxLength={32}
					required
					disabled={loading}
					aria-invalid={!!nameError}
					aria-describedby={`${id}-name-description${nameError ? ` ${id}-name-error` : ""}`}
				/>
				<p id={id + "-name-description"} className="text-xs text-muted-foreground">
					A unique name for this source.
				</p>
				<FieldError id={id + "-name-error"} message={nameError} />
			</div>

			{edit && (
				<div className="space-y-3">
					<p className="text-sm font-medium">Current location</p>
					<dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
						<dt className="text-muted-foreground">Machine</dt>
						<dd className="min-w-0 break-all">{edit.currentLocation.machine}</dd>
						<dt className="text-muted-foreground">Allowed location</dt>
						<dd className="min-w-0 break-all">{edit.currentLocation.location}</dd>
						<dt className="text-muted-foreground">Folder</dt>
						<dd className="min-w-0 break-all">
							{edit.currentLocation.logicalFolder === "Whole allowed location"
								? `Entire ${edit.currentLocation.location}`
								: `${edit.currentLocation.location}/${edit.currentLocation.logicalFolder}`}
						</dd>
					</dl>
					<p className="text-xs text-muted-foreground">{edit.currentLocation.explanation}</p>
					<Button
						type="button"
						variant="outline"
						onClick={() => {
							setChangingLocation(!changingLocation);
							setLocation(null);
							setErrors({});
						}}
					>
						{changingLocation ? "Keep current location" : "Change location"}
					</Button>
				</div>
			)}

			{changingLocation && (
				<div className="space-y-4">
					{edit && <p className="text-sm font-medium">New location</p>}
					<RemoteLocationPicker
						id={id}
						discovery={discovery}
						active={active}
						errors={errors}
						onChange={handleLocationChange}
						onDraftChange={setDraft}
						onFieldChange={clearLocationErrors}
					/>
					{edit && (
						<p className="text-sm text-muted-foreground">
							Existing backup schedules will use the new location. Review their file selections after
							saving.
						</p>
					)}
				</div>
			)}
		</form>
	);
}

export const AgentFilesystemSourceForm = (props: Props) => <SourceForm {...props} />;
export const EditAgentFilesystemSourceForm = (props: EditProps) => <SourceForm {...props} edit={props} />;
