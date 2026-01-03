import { arktypeResolver } from "@hookform/resolvers/arktype";
import { useMutation } from "@tanstack/react-query";
import { type } from "arktype";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { AuthLayout } from "~/client/components/auth-layout";
import { Button } from "~/client/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { authMiddleware } from "~/middleware/auth";
import type { Route } from "./+types/login";
import { loginMutation, verify2FaMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { Reset2faDialog } from "../components/reset-2fa-dialog";
import { ResetPasswordDialog } from "../components/reset-password-dialog";

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
	const [showReset2faDialog, setShowReset2faDialog] = useState(false);
	const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
	const [twoFactorCode, setTwoFactorCode] = useState("");

	const loginForm = useForm<LoginFormValues>({
		resolver: arktypeResolver(loginSchema),
		defaultValues: {
			username: "",
			password: "",
		},
	});

	const handleLoginSuccess = (user: { hasDownloadedResticPassword: boolean }) => {
		if (!user.hasDownloadedResticPassword) {
			navigate("/download-recovery-key");
		} else {
			navigate("/volumes");
		}
	};

	const login = useMutation({
		...loginMutation(),
		onSuccess: async (data) => {
			if (data.requiresTwoFactor && data.pendingSessionId) {
				setPendingSessionId(data.pendingSessionId);
				return;
			}
			if (data.user) {
				handleLoginSuccess(data.user);
			}
		},
		onError: (error) => {
			console.error(error);
			toast.error("Login failed", { description: error.message });
		},
	});

	const verify2fa = useMutation({
		...verify2FaMutation(),
		onSuccess: (data) => {
			if (data.user) {
				handleLoginSuccess(data.user);
			}
		},
		onError: (error) => {
			console.error(error);
			toast.error("Verification failed", { description: error.message });
		},
	});

	const onLoginSubmit = (values: LoginFormValues) => {
		login.mutate({
			body: {
				username: values.username.trim(),
				password: values.password.trim(),
			},
		});
	};

	const handleBackToLogin = () => {
		setPendingSessionId(null);
		setTwoFactorCode("");
	};

	const handleTwoFactorSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!pendingSessionId || twoFactorCode.length !== 6) return;
		verify2fa.mutate({
			body: {
				pendingSessionId,
				code: twoFactorCode,
			},
		});
	};

	// Show 2FA verification form
	if (pendingSessionId) {
		return (
			<AuthLayout
				title="Two-Factor Authentication"
				description="Enter the 6-digit code from your authenticator app"
			>
				<form onSubmit={handleTwoFactorSubmit} className="space-y-4">
					<div className="grid gap-2">
						<Label htmlFor="2fa-code">Authentication Code</Label>
						<Input
							id="2fa-code"
							type="text"
							inputMode="numeric"
							maxLength={6}
							placeholder="000000"
							disabled={verify2fa.isPending}
							autoFocus
							autoComplete="one-time-code"
							className="font-mono tracking-widest"
							value={twoFactorCode}
							onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ""))}
						/>
					</div>
					<Button type="submit" className="w-full" loading={verify2fa.isPending} disabled={twoFactorCode.length !== 6}>
						Verify
					</Button>
					<Button type="button" variant="ghost" className="w-full" onClick={handleBackToLogin}>
						Back to Login
					</Button>
					<div className="text-center">
						<button
							type="button"
							className="text-xs text-muted-foreground hover:underline"
							onClick={() => setShowReset2faDialog(true)}
						>
							Lost access to your authenticator?
						</button>
					</div>
				</form>
				<Reset2faDialog open={showReset2faDialog} onOpenChange={setShowReset2faDialog} />
			</AuthLayout>
		);
	}

	return (
		<AuthLayout title="Login to your account" description="Enter your credentials below to login to your account">
			<Form {...loginForm}>
				<form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-4">
					<FormField
						control={loginForm.control}
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
						control={loginForm.control}
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
