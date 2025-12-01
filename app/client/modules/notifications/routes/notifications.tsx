import { useQuery } from "@tanstack/react-query";
import { Bell, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { EmptyState } from "~/client/components/empty-state";
import { StatusDot } from "~/client/components/status-dot";
import { Button } from "~/client/components/ui/button";
import { Card } from "~/client/components/ui/card";
import { Input } from "~/client/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/client/components/ui/table";
import type { Route } from "./+types/notifications";
import { listNotificationDestinations } from "~/client/api-client";
import { listNotificationDestinationsOptions } from "~/client/api-client/@tanstack/react-query.gen";

export const handle = {
	breadcrumb: () => [{ label: "Notifications" }],
};

export function meta(_: Route.MetaArgs) {
	return [
		{ title: "Zerobyte - Notifications" },
		{
			name: "description",
			content: "Manage notification destinations for backup alerts.",
		},
	];
}

export const clientLoader = async () => {
	const result = await listNotificationDestinations();
	if (result.data) return result.data;
	return [];
};

export default function Notifications({ loaderData }: Route.ComponentProps) {
	const [searchQuery, setSearchQuery] = useState("");
	const [typeFilter, setTypeFilter] = useState("");
	const [statusFilter, setStatusFilter] = useState("");

	const clearFilters = () => {
		setSearchQuery("");
		setTypeFilter("");
		setStatusFilter("");
	};

	const navigate = useNavigate();

	const { data } = useQuery({
		...listNotificationDestinationsOptions(),
		initialData: loaderData,
	});

	const filteredNotifications =
		data?.filter((notification) => {
			const matchesSearch = notification.name.toLowerCase().includes(searchQuery.toLowerCase());
			const matchesType = !typeFilter || notification.type === typeFilter;
			const matchesStatus =
				!statusFilter || (statusFilter === "enabled" ? notification.enabled : !notification.enabled);
			return matchesSearch && matchesType && matchesStatus;
		}) || [];

	const hasNoNotifications = data.length === 0;
	const hasNoFilteredNotifications = filteredNotifications.length === 0 && !hasNoNotifications;

	if (hasNoNotifications) {
		return (
			<EmptyState
				icon={Bell}
				title="No notification destinations"
				description="Set up notification channels to receive alerts when your backups complete or fail."
				button={
					<Button onClick={() => navigate("/notifications/create")}>
						<Plus size={16} className="mr-2" />
						Create Destination
					</Button>
				}
			/>
		);
	}

	return (
		<Card className="p-0 gap-0">
			<div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2 md:justify-between p-4 bg-card-header py-4">
				<span className="flex flex-col sm:flex-row items-stretch md:items-center gap-0 flex-wrap ">
					<Input
						className="w-full lg:w-[180px] min-w-[180px] -mr-px -mt-px"
						placeholder="Search destinations…"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
					/>
					<Select value={typeFilter} onValueChange={setTypeFilter}>
						<SelectTrigger className="w-full lg:w-[180px] min-w-[180px] -mr-px -mt-px">
							<SelectValue placeholder="All types" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="email">Email</SelectItem>
							<SelectItem value="slack">Slack</SelectItem>
							<SelectItem value="discord">Discord</SelectItem>
							<SelectItem value="gotify">Gotify</SelectItem>
							<SelectItem value="ntfy">Ntfy</SelectItem>
							<SelectItem value="pushover">Pushover</SelectItem>
							<SelectItem value="telegram">Telegram</SelectItem>
							<SelectItem value="custom">Custom</SelectItem>
						</SelectContent>
					</Select>
					<Select value={statusFilter} onValueChange={setStatusFilter}>
						<SelectTrigger className="w-full lg:w-[180px] min-w-[180px] -mt-px">
							<SelectValue placeholder="All status" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="enabled">Enabled</SelectItem>
							<SelectItem value="disabled">Disabled</SelectItem>
						</SelectContent>
					</Select>
					{(searchQuery || typeFilter || statusFilter) && (
						<Button onClick={clearFilters} className="w-full lg:w-auto mt-2 lg:mt-0 lg:ml-2">
							<RotateCcw className="h-4 w-4 mr-2" />
							Clear filters
						</Button>
					)}
				</span>
				<Button onClick={() => navigate("/notifications/create")}>
					<Plus size={16} className="mr-2" />
					Create Destination
				</Button>
			</div>
			<div className="overflow-x-auto">
				<Table className="border-t">
					<TableHeader className="bg-card-header">
						<TableRow>
							<TableHead className="w-[100px] uppercase">Name</TableHead>
							<TableHead className="uppercase text-left">Type</TableHead>
							<TableHead className="uppercase text-center">Status</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{hasNoFilteredNotifications ? (
							<TableRow>
								<TableCell colSpan={3} className="text-center py-12">
									<div className="flex flex-col items-center gap-3">
										<p className="text-muted-foreground">No destinations match your filters.</p>
										<Button onClick={clearFilters} variant="outline" size="sm">
											<RotateCcw className="h-4 w-4 mr-2" />
											Clear filters
										</Button>
									</div>
								</TableCell>
							</TableRow>
						) : (
							filteredNotifications.map((notification) => (
								<TableRow
									key={notification.id}
									className="hover:bg-accent/50 hover:cursor-pointer"
									onClick={() => navigate(`/notifications/${notification.id}`)}
								>
									<TableCell className="font-medium text-strong-accent">{notification.name}</TableCell>
									<TableCell className="capitalize">{notification.type}</TableCell>
									<TableCell className="text-center">
										<StatusDot
											variant={notification.enabled ? "success" : "neutral"}
											label={notification.enabled ? "Enabled" : "Disabled"}
										/>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>
			<div className="px-4 py-2 text-sm text-muted-foreground bg-card-header flex justify-end border-t">
				<span>
					<span className="text-strong-accent">{filteredNotifications.length}</span> destination
					{filteredNotifications.length !== 1 ? "s" : ""}
				</span>
			</div>
		</Card>
	);
}
