import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import { Switch } from "~/client/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/client/components/ui/table";
import { Badge } from "~/client/components/ui/badge";
import {
	getScheduleNotificationsOptions,
	updateScheduleNotificationsMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import { parseError } from "~/client/lib/errors";
import type { NotificationDestination } from "~/client/lib/types";
import type { GetScheduleNotificationsResponse } from "~/client/api-client";

type Props = {
	scheduleId: number;
	destinations: NotificationDestination[];
	initialData: GetScheduleNotificationsResponse;
};

type NotificationAssignment = {
	destinationId: number;
	notifyOnStart: boolean;
	notifyOnSuccess: boolean;
	notifyOnWarning: boolean;
	notifyOnFailure: boolean;
};

export const ScheduleNotificationsConfig = ({ scheduleId, destinations, initialData }: Props) => {
	const map = new Map<number, NotificationAssignment>();
	for (const assignment of initialData) {
		map.set(assignment.destinationId, {
			destinationId: assignment.destinationId,
			notifyOnStart: assignment.notifyOnStart,
			notifyOnSuccess: assignment.notifyOnSuccess,
			notifyOnWarning: assignment.notifyOnWarning,
			notifyOnFailure: assignment.notifyOnFailure,
		});
	}

	const [assignments, setAssignments] = useState<Map<number, NotificationAssignment>>(map);
	const [hasChanges, setHasChanges] = useState(false);
	const [isAddingNew, setIsAddingNew] = useState(false);

	const { data: currentAssignments } = useQuery({
		...getScheduleNotificationsOptions({ path: { scheduleId: scheduleId.toString() } }),
		initialData,
	});

	const updateNotifications = useMutation({
		...updateScheduleNotificationsMutation(),
		onSuccess: () => {
			toast.success("Notification settings saved successfully");
			setHasChanges(false);
		},
		onError: (error) => {
			toast.error("Failed to save notification settings", {
				description: parseError(error)?.message,
			});
		},
	});

	const addDestination = (destinationId: string) => {
		const id = Number.parseInt(destinationId, 10);
		const newAssignments = new Map(assignments);
		newAssignments.set(id, {
			destinationId: id,
			notifyOnStart: false,
			notifyOnSuccess: false,
			notifyOnWarning: true,
			notifyOnFailure: true,
		});

		setAssignments(newAssignments);
		setHasChanges(true);
		setIsAddingNew(false);
	};

	const removeDestination = (destinationId: number) => {
		const newAssignments = new Map(assignments);
		newAssignments.delete(destinationId);
		setAssignments(newAssignments);
		setHasChanges(true);
	};

	const toggleEvent = (
		destinationId: number,
		event: "notifyOnStart" | "notifyOnSuccess" | "notifyOnWarning" | "notifyOnFailure",
	) => {
		const assignment = assignments.get(destinationId);
		if (!assignment) return;

		const newAssignments = new Map(assignments);
		newAssignments.set(destinationId, {
			...assignment,
			[event]: !assignment[event],
		});

		setAssignments(newAssignments);
		setHasChanges(true);
	};

	const handleSave = () => {
		const assignmentsList = Array.from(assignments.values());
		updateNotifications.mutate({
			path: { scheduleId: scheduleId.toString() },
			body: {
				assignments: assignmentsList,
			},
		});
	};

	const handleReset = () => {
		if (currentAssignments) {
			const map = new Map<number, NotificationAssignment>();
			for (const assignment of currentAssignments) {
				map.set(assignment.destinationId, {
					destinationId: assignment.destinationId,
					notifyOnStart: assignment.notifyOnStart,
					notifyOnSuccess: assignment.notifyOnSuccess,
					notifyOnWarning: assignment.notifyOnWarning,
					notifyOnFailure: assignment.notifyOnFailure,
				});
			}
			setAssignments(map);
			setHasChanges(false);
		}
	};

	const getDestinationById = (id: number) => {
		return destinations?.find((d) => d.id === id);
	};

	const availableDestinations = destinations?.filter((d) => !assignments.has(d.id)) || [];
	const assignedDestinations = Array.from(assignments.keys())
		.map((id) => getDestinationById(id))
		.filter((d) => d !== undefined);

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<Bell className="h-5 w-5" />
							Notifications
						</CardTitle>
						<CardDescription className="hidden @md:block mt-1">
							Configure which notifications to send for this backup schedule
						</CardDescription>
					</div>
					{!isAddingNew && availableDestinations.length > 0 && (
						<Button variant="outline" size="sm" onClick={() => setIsAddingNew(true)}>
							<Plus className="h-4 w-4 mr-2" />
							Add notification
						</Button>
					)}
				</div>
			</CardHeader>
			<CardContent>
				{isAddingNew && (
					<div className="mb-6 flex items-center gap-2 max-w-md">
						<Select onValueChange={addDestination}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Select a notification destination..." />
							</SelectTrigger>
							<SelectContent>
								{availableDestinations.map((destination) => (
									<SelectItem key={destination.id} value={destination.id.toString()}>
										<div className="flex items-center gap-2">
											<span>{destination.name}</span>
											<span className="text-xs uppercase text-muted-foreground">({destination.type})</span>
										</div>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Button variant="ghost" size="sm" onClick={() => setIsAddingNew(false)}>
							Cancel
						</Button>
					</div>
				)}

				{assignedDestinations.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
						<Bell className="h-8 w-8 mb-2 opacity-20" />
						<p className="text-sm">No notifications configured for this schedule.</p>
						<p className="text-xs mt-1">Click "Add notification" to get started.</p>
					</div>
				) : (
					<div className="rounded-md border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Destination</TableHead>
									<TableHead className="text-center w-25">Start</TableHead>
									<TableHead className="text-center w-25">Success</TableHead>
									<TableHead className="text-center w-25">Warnings</TableHead>
									<TableHead className="text-center w-25">Failures</TableHead>
									<TableHead className="w-12.5"></TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{assignedDestinations.map((destination) => {
									const assignment = assignments.get(destination.id);
									if (!assignment) return null;

									return (
										<TableRow key={destination.id}>
											<TableCell>
												<div className="flex items-center gap-2">
													<span className="font-medium">{destination.name}</span>
													<Badge variant="outline" className="text-[10px] align-middle">
														{destination.type}
													</Badge>
												</div>
											</TableCell>
											<TableCell className="text-center">
												<Switch
													className="align-middle"
													checked={assignment.notifyOnStart}
													onCheckedChange={() => toggleEvent(destination.id, "notifyOnStart")}
												/>
											</TableCell>
											<TableCell className="text-center">
												<Switch
													className="align-middle"
													checked={assignment.notifyOnSuccess}
													onCheckedChange={() => toggleEvent(destination.id, "notifyOnSuccess")}
												/>
											</TableCell>
											<TableCell className="text-center">
												<Switch
													className="align-middle"
													checked={assignment.notifyOnWarning}
													onCheckedChange={() => toggleEvent(destination.id, "notifyOnWarning")}
												/>
											</TableCell>
											<TableCell className="text-center">
												<Switch
													className="align-middle"
													checked={assignment.notifyOnFailure}
													onCheckedChange={() => toggleEvent(destination.id, "notifyOnFailure")}
												/>
											</TableCell>
											<TableCell>
												<Button
													variant="ghost"
													size="icon"
													onClick={() => removeDestination(destination.id)}
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
						<Button variant="default" size="sm" onClick={handleSave} loading={updateNotifications.isPending}>
							Save changes
						</Button>
					</div>
				)}
			</CardContent>
		</Card>
	);
};
