import { Settings } from "lucide-react";
import { toast } from "sonner";
import { CardContent, CardDescription, CardTitle } from "~/client/components/ui/card";
import { Label } from "~/client/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { useRootLoaderData } from "~/client/hooks/use-root-loader-data";
import { authClient } from "~/client/lib/auth-client";
import {
	DATE_FORMATS,
	type DateFormatPreference,
	TIME_FORMATS,
	type TimeFormatPreference,
	useTimeFormat,
} from "~/client/lib/datetime";

export function DateTimeFormatSection() {
	const { dateFormat, timeFormat } = useRootLoaderData();
	const { formatDateTime } = useTimeFormat();
	const handleDateTimeFormatChange = async (
		nextDateFormat: DateFormatPreference,
		nextTimeFormat: TimeFormatPreference,
	) => {
		await authClient.updateUser({
			dateFormat: nextDateFormat,
			timeFormat: nextTimeFormat,
			fetchOptions: {
				onError: ({ error }) => {
					toast.error("Failed to update date and time format", {
						description: error.message,
					});
				},
				onSuccess: () => {
					window.location.reload();
				},
			},
		});
	};

	const handleDateFormatChange = async (nextDateFormat: DateFormatPreference) => {
		if (nextDateFormat === dateFormat) {
			return;
		}

		await handleDateTimeFormatChange(nextDateFormat, timeFormat);
	};

	const handleTimeFormatChange = async (nextTimeFormat: TimeFormatPreference) => {
		if (nextTimeFormat === timeFormat) {
			return;
		}

		await handleDateTimeFormatChange(dateFormat, nextTimeFormat);
	};

	return (
		<>
			<div className="bg-card-header p-6">
				<CardTitle className="flex items-center gap-2">
					<Settings className="size-5" />
					Date and Time Format
				</CardTitle>
				<CardDescription className="mt-1.5">
					Choose how dates and times are shown throughout the app
				</CardDescription>
			</div>
			<CardContent className="p-6">
				<div className="space-y-4 max-w-2xl">
					<div className="grid gap-4 md:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="date-format">Date format</Label>
							<Select
								value={dateFormat}
								onValueChange={(value) => void handleDateFormatChange(value as DateFormatPreference)}
							>
								<SelectTrigger id="date-format">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{DATE_FORMATS.map((value) => (
										<SelectItem key={value} value={value}>
											{value}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-2">
							<Label htmlFor="time-format">Time format</Label>
							<Select
								value={timeFormat}
								onValueChange={(value) => void handleTimeFormatChange(value as TimeFormatPreference)}
							>
								<SelectTrigger id="time-format">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{TIME_FORMATS.map((value) => (
										<SelectItem key={value} value={value}>
											{value}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<p className="text-sm text-muted-foreground">Preview: {formatDateTime(new Date())}</p>
				</div>
			</CardContent>
		</>
	);
}
