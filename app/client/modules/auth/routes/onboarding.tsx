import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "~/client/components/ui/form";
import { AuthLayout } from "~/client/components/auth-layout";
import { Input } from "~/client/components/ui/input";
import { Button } from "~/client/components/ui/button";
import { authClient } from "~/client/lib/auth-client";
import { logger } from "~/client/lib/logger";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { normalizeUsername } from "~/lib/username";
import { z } from "zod";
import { inferDateTimePreferences } from "~/client/lib/datetime";

const onboardingSchema = z.object({
	username: z.string().min(2).max(30).transform(normalizeUsername),
	email: z
		.string()
		.email()
		.transform((str) => str.trim().toLowerCase()),
	password: z.string().min(8),
	confirmPassword: z.string().min(1),
});

type OnboardingFormValues = z.input<typeof onboardingSchema>;

export function OnboardingPage() {
	const navigate = useNavigate();
	const [submitting, setSubmitting] = useState(false);

	const form = useForm<OnboardingFormValues>({
		resolver: zodResolver(onboardingSchema),
		defaultValues: {
			username: "",
			password: "",
			confirmPassword: "",
			email: "",
		},
	});

	const onSubmit = async (values: OnboardingFormValues) => {
		if (values.password !== values.confirmPassword) {
			form.setError("confirmPassword", {
				type: "manual",
				message: "Passwords do not match",
			});
			return;
		}

		const { dateFormat, timeFormat } = inferDateTimePreferences(navigator.language);

		const { data, error } = await authClient.signUp.email({
			username: normalizeUsername(values.username),
			dateFormat,
			timeFormat,
			password: values.password,
			email: values.email.toLowerCase().trim(),
			name: values.username,
			displayUsername: values.username,
			hasDownloadedResticPassword: false,
			fetchOptions: {
				onRequest: () => {
					setSubmitting(true);
				},
				onResponse: () => {
					setSubmitting(false);
				},
			},
		});

		if (data?.token) {
			toast.success("Admin user created successfully!");
			void navigate({ to: "/download-recovery-key" });
		} else if (error) {
			logger.error(error);
			const errorMessage = error.message ?? "Unknown error";
			toast.error("Failed to create admin user", { description: errorMessage });
		}
	};

	return (
		<AuthLayout title="Welcome to Zerobyte" description="Create the admin user to get started">
			<Form {...form}>
				<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
					<FormField
						control={form.control}
						name="email"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Email</FormLabel>
								<FormControl>
									<Input {...field} type="email" placeholder="you@example.com" disabled={submitting} />
								</FormControl>
								<FormDescription>Enter your email address</FormDescription>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name="username"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Username</FormLabel>
								<FormControl>
									<Input {...field} type="text" placeholder="admin" disabled={submitting} />
								</FormControl>
								<FormDescription>Choose a username for the admin account</FormDescription>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name="password"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Password</FormLabel>
								<FormControl>
									<Input {...field} type="password" placeholder="Enter a secure password" disabled={submitting} />
								</FormControl>
								<FormDescription>Password must be at least 8 characters long.</FormDescription>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name="confirmPassword"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Confirm Password</FormLabel>
								<FormControl>
									<Input {...field} type="password" placeholder="Re-enter your password" disabled={submitting} />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<Button type="submit" className="w-full" loading={submitting}>
						Create admin user
					</Button>
				</form>
			</Form>
		</AuthLayout>
	);
}
