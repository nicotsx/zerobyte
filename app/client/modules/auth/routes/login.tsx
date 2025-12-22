import { arktypeResolver } from "@hookform/resolvers/arktype";
import { useMutation } from "@tanstack/react-query";
import { type } from "arktype";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { AuthLayout } from "~/client/components/auth-layout";
import { Button } from "~/client/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/client/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Input } from "~/client/components/ui/input";
import { authMiddleware } from "~/middleware/auth";
import type { Route } from "./+types/login";
import { loginMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { copyToClipboard } from "~/utils/clipboard";

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

	const form = useForm<LoginFormValues>({
		resolver: arktypeResolver(loginSchema),
		defaultValues: {
			username: "",
			password: "",
		},
	});

	const login = useMutation({
		...loginMutation(),
		onSuccess: async (data) => {
			if (data.user && !data.user.hasDownloadedResticPassword) {
				navigate("/download-recovery-key");
			} else {
				navigate("/volumes");
			}
		},
		onError: (error) => {
			console.error(error);
			toast.error("Login failed", { description: error.message });
		},
	});

	const onSubmit = (values: LoginFormValues) => {
		login.mutate({
			body: {
				username: values.username.trim(),
				password: values.password.trim(),
			},
		});
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
									<Input {...field} type="text" placeholder="admin" disabled={login.isPending} autoFocus />
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
									<Input {...field} type="password" disabled={login.isPending} />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<Button type="submit" className="w-full" loading={login.isPending}>
						Login
					</Button>
				</form>
			</Form>

			<ResetPasswordDialog open={showResetDialog} onOpenChange={setShowResetDialog} />
		</AuthLayout>
	);
}

const RESET_PASSWORD_COMMAND = "docker exec -it zerobyte bun run cli reset-password";

function ResetPasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	const handleCopy = async () => {
		await copyToClipboard(RESET_PASSWORD_COMMAND);
		toast.success("Command copied to clipboard");
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Reset your password</DialogTitle>
					<DialogDescription>
						To reset your password, run the following command on the server where Zerobyte is installed.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<div className="rounded-md bg-muted p-4 font-mono text-sm break-all">{RESET_PASSWORD_COMMAND}</div>
					<p className="text-sm text-muted-foreground">
						This command will start an interactive session where you can enter a new password for your account.
					</p>
					<Button onClick={handleCopy} variant="outline" className="w-full">
						Copy Command
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
