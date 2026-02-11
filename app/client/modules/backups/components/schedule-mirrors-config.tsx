import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import { Switch } from "~/client/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/client/components/ui/table";
import { Badge } from "~/client/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/client/components/ui/tooltip";
import {
	getScheduleMirrorsOptions,
	getMirrorCompatibilityOptions,
	updateScheduleMirrorsMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import { parseError } from "~/client/lib/errors";
import type { Repository } from "~/client/lib/types";
import { RepositoryIcon } from "~/client/components/repository-icon";
import { StatusDot } from "~/client/components/status-dot";
import { useServerEvents } from "~/client/hooks/use-server-events";
import { formatDistanceToNow } from "date-fns";
import { cn } from "~/client/lib/utils";
import type { GetScheduleMirrorsResponse } from "~/client/api-client";
import { Link } from "@tanstack/react-router";

type Props = {
	scheduleId: number;
	primaryRepositoryId: string;
	repositories: Repository[];
	initialData: GetScheduleMirrorsResponse;
};

type MirrorAssignment = {
	repositoryId: string;
	enabled: boolean;
	lastCopyAt: number | null;
	lastCopyStatus: "success" | "error" | "in_progress" | null;
	lastCopyError: string | null;
};

const isSyncing = (assignment: MirrorAssignment) => assignment.lastCopyStatus === "in_progress";

const buildAssignments = (mirrors: GetScheduleMirrorsResponse) =>
	new Map<string, MirrorAssignment>(
		mirrors.map((mirror) => [
			mirror.repositoryId,
			{
				repositoryId: mirror.repositoryId,
				enabled: mirror.enabled,
				lastCopyAt: mirror.lastCopyAt,
				lastCopyStatus: mirror.lastCopyStatus,
				lastCopyError: mirror.lastCopyError,
			},
		]),
	);

export const ScheduleMirrorsConfig = ({ scheduleId, primaryRepositoryId, repositories, initialData }: Props) => {
	const [assignments, setAssignments] = useState<Map<string, MirrorAssignment>>(() => buildAssignments(initialData));
	const [hasChanges, setHasChanges] = useState(false);
	const [isAddingNew, setIsAddingNew] = useState(false);
	const { addEventListener } = useServerEvents();

	const { data: currentMirrors } = useSuspenseQuery({
		...getScheduleMirrorsOptions({ path: { scheduleId: scheduleId.toString() } }),
	});

	useEffect(() => {
		if (!hasChanges) {
			setAssignments(buildAssignments(currentMirrors));
		}
	}, [currentMirrors, hasChanges]);

	const { data: compatibility } = useQuery({
		...getMirrorCompatibilityOptions({ path: { scheduleId: scheduleId.toString() } }),
	});

	const updateMirrors = useMutation({
		...updateScheduleMirrorsMutation(),
		onSuccess: () => {
			toast.success("Mirror settings saved successfully");
			setHasChanges(false);
		},
		onError: (error) => {
			toast.error("Failed to save mirror settings", {
				description: parseError(error)?.message,
			});
		},
	});

	const compatibilityMap = useMemo(() => {
		const map = new Map<string, { compatible: boolean; reason: string | null }>();
		if (compatibility) {
			for (const item of compatibility) {
				map.set(item.repositoryId, { compatible: item.compatible, reason: item.reason });
			}
		}
		return map;
	}, [compatibility]);

	useEffect(() => {
		const unsubscribeStarted = addEventListener("mirror:started", (data) => {
			const event = data as { scheduleId: number; repositoryId: string };
			if (event.scheduleId !== scheduleId) return;
			setAssignments((prev) => {
				const next = new Map(prev);
				const existing = next.get(event.repositoryId);
				if (!existing) return prev;
				next.set(event.repositoryId, { ...existing, lastCopyStatus: "in_progress", lastCopyError: null });
				return next;
			});
		});

		const unsubscribeCompleted = addEventListener("mirror:completed", (data) => {
			const event = data as { scheduleId: number; repositoryId: string; status?: "success" | "error"; error?: string };
			if (event.scheduleId !== scheduleId) return;
			setAssignments((prev) => {
				const next = new Map(prev);
				const existing = next.get(event.repositoryId);
				if (!existing) return prev;
				next.set(event.repositoryId, {
					...existing,
					lastCopyStatus: event.status ?? existing.lastCopyStatus,
					lastCopyError: event.error ?? null,
					lastCopyAt: Date.now(),
				});
				return next;
			});
		});

		return () => {
			unsubscribeStarted();
			unsubscribeCompleted();
		};
	}, [addEventListener, scheduleId]);

	const addRepository = (repositoryId: string) => {
		const newAssignments = new Map(assignments);
		newAssignments.set(repositoryId, {
			repositoryId,
			enabled: true,
			lastCopyAt: null,
			lastCopyStatus: null,
			lastCopyError: null,
		});

		setAssignments(newAssignments);
		setHasChanges(true);
		setIsAddingNew(false);
	};

	const removeRepository = (repositoryId: string) => {
		const newAssignments = new Map(assignments);
		newAssignments.delete(repositoryId);
		setAssignments(newAssignments);
		setHasChanges(true);
	};

	const toggleEnabled = (repositoryId: string) => {
		const assignment = assignments.get(repositoryId);
		if (!assignment) return;

		const newAssignments = new Map(assignments);
		newAssignments.set(repositoryId, {
			...assignment,
			enabled: !assignment.enabled,
		});

		setAssignments(newAssignments);
		setHasChanges(true);
	};

	const handleSave = () => {
		const mirrorsList = Array.from(assignments.values()).map((a) => ({
			repositoryId: a.repositoryId,
			enabled: a.enabled,
		}));
		updateMirrors.mutate({
			path: { scheduleId: scheduleId.toString() },
			body: {
				mirrors: mirrorsList,
			},
		});
	};

	const handleReset = () => {
		setAssignments(buildAssignments(currentMirrors));
		setHasChanges(false);
	};

	const selectableRepositories =
		repositories?.filter((r) => {
			if (r.id === primaryRepositoryId) return false;
			if (assignments.has(r.id)) return false;
			return true;
		}) || [];

	const hasAvailableRepositories = selectableRepositories.some((r) => {
		const compat = compatibilityMap.get(r.id);
		return compat?.compatible !== false;
	});

	const assignedRepositories = Array.from(assignments.keys())
		.map((id) => repositories?.find((r) => r.id === id))
		.filter((r) => r !== undefined);

	const getStatusVariant = (status: string | null) => {
		if (status === "success") return "success";
		if (status === "error") return "error";
		if (status === "in_progress") return "info";
		return "neutral";
	};

	const getLabel = (assignment: MirrorAssignment) => {
		if (isSyncing(assignment)) {
			return "Syncing...";
		}
		if (assignment.lastCopyAt) {
			return formatDistanceToNow(new Date(assignment.lastCopyAt), { addSuffix: true });
		}
		return "Never";
	};

	const getStatusLabel = (assignment: MirrorAssignment) => {
		if (isSyncing(assignment)) {
			return "Mirror sync in progress";
		}
		if (assignment.lastCopyStatus === "error" && assignment.lastCopyError) {
			return assignment.lastCopyError;
		}
		if (assignment.lastCopyStatus === "success") {
			return "Last copy successful";
		}
		return "Never copied";
	};

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<Copy className="h-5 w-5" />
							Mirror Repositories
						</CardTitle>
						<CardDescription className="hidden @md:block mt-1">
							Configure secondary repositories where snapshots will be automatically copied after each backup
						</CardDescription>
					</div>
					{!isAddingNew && selectableRepositories.length > 0 && (
						<Button variant="outline" size="sm" onClick={() => setIsAddingNew(true)}>
							<Plus className="h-4 w-4 mr-2" />
							Add mirror
						</Button>
					)}
				</div>
			</CardHeader>
			<CardContent>
				{isAddingNew && (
					<div className="mb-6 flex items-center gap-2 max-w-md">
						<Select onValueChange={addRepository}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Select a repository to mirror to..." />
							</SelectTrigger>
							<SelectContent>
								{selectableRepositories.map((repository) => {
									const compat = compatibilityMap.get(repository.id);

									return (
										<Tooltip key={repository.id}>
											<TooltipTrigger asChild>
												<div>
													<SelectItem value={repository.id} disabled={!compat?.compatible}>
														<div className="flex items-center gap-2">
															<RepositoryIcon backend={repository.type} className="h-4 w-4" />
															<span>{repository.name}</span>
															<span className="text-xs uppercase text-muted-foreground">({repository.type})</span>
														</div>
													</SelectItem>
												</div>
											</TooltipTrigger>
											<TooltipContent side="right" className={cn("max-w-xs", { hidden: compat?.compatible })}>
												<p>{compat?.reason || "This repository is not compatible for mirroring."}</p>
												<p className="mt-1 text-xs text-muted-foreground">
													Consider creating a new backup scheduler with the desired destination instead.
												</p>
											</TooltipContent>
										</Tooltip>
									);
								})}
								{!hasAvailableRepositories && selectableRepositories.length > 0 && (
									<div className="px-2 py-3 text-sm text-muted-foreground text-center">
										All available repositories have conflicting backends.
										<br />
										<span className="text-xs">
											Consider creating a new backup scheduler with the desired destination instead.
										</span>
									</div>
								)}
							</SelectContent>
						</Select>
						<Button variant="ghost" size="sm" onClick={() => setIsAddingNew(false)}>
							Cancel
						</Button>
					</div>
				)}

				{assignedRepositories.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
						<Copy className="h-8 w-8 mb-2 opacity-20" />
						<p className="text-sm">No mirror repositories configured for this schedule.</p>
						<p className="text-xs mt-1">Click "Add mirror" to replicate backups to additional repositories.</p>
					</div>
				) : (
					<div className="rounded-md border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Repository</TableHead>
									<TableHead className="text-center w-25">Enabled</TableHead>
									<TableHead className="w-45">Last Copy</TableHead>
									<TableHead className="w-12.5"></TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{assignedRepositories.map((repository) => {
									const assignment = assignments.get(repository.id);
									if (!assignment) return null;

									return (
										<TableRow key={repository.id}>
											<TableCell>
												<div className="flex items-center gap-2">
													<Link
														to="/repositories/$repositoryId"
														params={{ repositoryId: repository.id }}
														className="hover:underline flex items-center gap-2"
													>
														<RepositoryIcon backend={repository.type} className="h-4 w-4" />
														<span className="font-medium">{repository.name}</span>
													</Link>
													<Badge variant="outline" className="text-[10px] align-middle">
														{repository.type}
													</Badge>
												</div>
											</TableCell>
											<TableCell className="text-center">
												<Switch
													className="align-middle"
													checked={assignment.enabled}
													onCheckedChange={() => toggleEnabled(repository.id)}
												/>
											</TableCell>
											<TableCell>
												<div className="flex items-center gap-2">
													<StatusDot
														variant={getStatusVariant(assignment.lastCopyStatus)}
														label={getStatusLabel(assignment)}
														animated={isSyncing(assignment) ? true : undefined}
													/>
													<span className="text-sm text-muted-foreground">{getLabel(assignment)}</span>
												</div>
											</TableCell>
											<TableCell>
												<Button
													variant="ghost"
													size="icon"
													onClick={() => removeRepository(repository.id)}
													className="h-8 w-8 text-muted-foreground hover:text-destructive align-baseline"
												>
													<Trash2 className="h-4 w-4" />
												</Button>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</div>
				)}

				{hasChanges && (
					<div className="flex gap-2 justify-end mt-4 pt-4">
						<Button variant="outline" size="sm" onClick={handleReset}>
							Cancel
						</Button>
						<Button variant="default" size="sm" onClick={handleSave} loading={updateMirrors.isPending}>
							Save changes
						</Button>
					</div>
				)}
			</CardContent>
		</Card>
	);
};
