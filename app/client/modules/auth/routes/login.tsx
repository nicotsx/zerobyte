import { arktypeResolver } from "@hookform/resolvers/arktype";
import { type } from "arktype";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { AuthLayout } from "~/client/components/auth-layout";
import { Button } from "~/client/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Input } from "~/client/components/ui/input";
import { authMiddleware } from "~/middleware/auth";
import type { Route } from "./+types/login";
import { ResetPasswordDialog } from "../components/reset-password-dialog";
import { authClient } from "~/client/lib/auth-client";

export const clientMiddleware = [authMiddleware];

export function meta(_: Route.MetaArgs) {
	return [
		{ title: "Zerobyte - Login" },
		{
			name: "description",
			content: "Sign in to your Zerobyte account.",
		},
	];
}

const loginSchema = type({
	username: "2<=string<=50",
	password: "string>=1",
});

type LoginFormValues = typeof loginSchema.inferIn;

export default function LoginPage() {
	const navigate = useNavigate();
	const [showResetDialog, setShowResetDialog] = useState(false);
	const [isLoggingIn, setIsLoggingIn] = useState(false);

	const form = useForm<LoginFormValues>({
		resolver: arktypeResolver(loginSchema),
		defaultValues: {
			username: "",
			password: "",
		},
	});

	const onSubmit = async (values: LoginFormValues) => {
		const { data, error } = await authClient.signIn.username({
			username: values.username.toLowerCase().trim(),
			password: values.password,
			fetchOptions: {
				onRequest: () => {
					setIsLoggingIn(true);
				},
				onResponse: () => {
					setIsLoggingIn(false);
				},
			},
		});

		if (error) {
			console.error(error);
			toast.error("Login failed", { description: error.message });
			return;
		}

		const d = await authClient.getSession();
		if (data.user && !d.data?.user.hasDownloadedResticPassword) {
			void navigate("/download-recovery-key");
		} else {
			void navigate("/volumes");
		}
	};

	return (
		<AuthLayout title="Login to your account" description="Enter your credentials below to login to your account">
			<Form {...form}>
				<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
					<FormField
						control={form.control}
						name="username"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Username</FormLabel>
								<FormControl>
									<Input {...field} type="text" placeholder="admin" disabled={isLoggingIn} autoFocus />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name="password"
						render={({ field }) => (
							<FormItem>
								<div className="flex items-center justify-between">
									<FormLabel>Password</FormLabel>
									<button
										type="button"
										className="text-xs text-muted-foreground hover:underline"
										onClick={() => setShowResetDialog(true)}
									>
										Forgot your password?
									</button>
								</div>
								<FormControl>
									<Input {...field} type="password" disabled={isLoggingIn} />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<Button type="submit" className="w-full" loading={isLoggingIn}>
						Login
					</Button>
				</form>
			</Form>

			<ResetPasswordDialog open={showResetDialog} onOpenChange={setShowResetDialog} />
		</AuthLayout>
	);
}
