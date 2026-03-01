import { arktypeResolver } from "@hookform/resolvers/arktype";
import { type } from "arktype";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { AuthLayout } from "~/client/components/auth-layout";
import { Button } from "~/client/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Input } from "~/client/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "~/client/components/ui/input-otp";
import { Label } from "~/client/components/ui/label";
import { authClient } from "~/client/lib/auth-client";
import { decodeLoginError, getLoginErrorDescription } from "~/client/lib/auth-errors";
import { ResetPasswordDialog } from "../components/reset-password-dialog";
import { useNavigate } from "@tanstack/react-router";
import { normalizeUsername } from "~/lib/username";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { getPublicSsoProvidersOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { cn } from "~/client/lib/utils";

const loginSchema = type({
	username: "2<=string<=50",
	password: "string>=1",
});

type LoginFormValues = typeof loginSchema.inferIn;

type LoginPageProps = {
	error?: string;
};

export function LoginPage({ error }: LoginPageProps = {}) {
	const navigate = useNavigate();
	const [showResetDialog, setShowResetDialog] = useState(false);
	const [isLoggingIn, setIsLoggingIn] = useState(false);
	const [requires2FA, setRequires2FA] = useState(false);
	const [totpCode, setTotpCode] = useState("");
	const [isVerifying2FA, setIsVerifying2FA] = useState(false);
	const [trustDevice, setTrustDevice] = useState(false);
	const errorCode = decodeLoginError(error);
	const errorDescription = getLoginErrorDescription(errorCode);

	const { data: ssoProviders } = useSuspenseQuery({
		...getPublicSsoProvidersOptions(),
	});

	const form = useForm<LoginFormValues>({
		resolver: arktypeResolver(loginSchema),
		defaultValues: {
			username: "",
			password: "",
		},
	});

	const onSubmit = async (values: LoginFormValues) => {
		const { data, error } = await authClient.signIn.username({
			username: normalizeUsername(values.username),
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

		if ("twoFactorRedirect" in data && data.twoFactorRedirect) {
			setRequires2FA(true);
			return;
		}

		const d = await authClient.getSession();
		if (data.user && !d.data?.user.hasDownloadedResticPassword) {
			void navigate({ to: "/download-recovery-key" });
		} else {
			void navigate({ to: "/volumes" });
		}
	};

	const handleVerify2FA = async () => {
		if (totpCode.length !== 6) {
			toast.error("Please enter a 6-digit code");
			return;
		}

		const { data, error } = await authClient.twoFactor.verifyTotp({
			code: totpCode,
			trustDevice,
			fetchOptions: {
				onRequest: () => {
					setIsVerifying2FA(true);
				},
				onResponse: () => {
					setIsVerifying2FA(false);
				},
			},
		});

		if (error) {
			console.error(error);
			toast.error("Verification failed", { description: error.message });
			setTotpCode("");
			return;
		}

		if (data) {
			toast.success("Login successful");
			const session = await authClient.getSession();
			if (session.data?.user && !session.data.user.hasDownloadedResticPassword) {
				void navigate({ to: "/download-recovery-key" });
			} else {
				void navigate({ to: "/volumes" });
			}
		}
	};

	const handleBackToLogin = () => {
		setRequires2FA(false);
		setTotpCode("");
		setTrustDevice(false);
		form.reset();
	};

	const ssoLoginMutation = useMutation({
		mutationFn: async (providerId: string) => {
			const callbackPath = "/login";
			const { data, error } = await authClient.signIn.sso({
				providerId: providerId,
				callbackURL: callbackPath,
				errorCallbackURL: "/api/v1/auth/login-error",
			});
			if (error) throw error;

			return data;
		},
		onSuccess: (data) => {
			window.location.href = data.url;
		},
		onError: (error) => {
			console.error(error);
			toast.error("SSO Login failed", { description: error.message });
		},
	});

	if (requires2FA) {
		return (
			<AuthLayout title="Two-Factor Authentication" description="Enter the 6-digit code from your authenticator app">
				<div className="space-y-6">
					<div className="space-y-4 flex flex-col items-center">
						<Label htmlFor="totp-code">Authentication code</Label>
						<div>
							<InputOTP
								maxLength={6}
								value={totpCode}
								onChange={setTotpCode}
								onComplete={handleVerify2FA}
								disabled={isVerifying2FA}
							>
								<InputOTPGroup>
									<InputOTPSlot index={0} />
									<InputOTPSlot index={1} />
									<InputOTPSlot index={2} />
								</InputOTPGroup>
								<InputOTPSeparator />
								<InputOTPGroup>
									<InputOTPSlot index={3} />
									<InputOTPSlot index={4} />
									<InputOTPSlot index={5} />
								</InputOTPGroup>
							</InputOTP>
						</div>
					</div>

					<div className="flex items-center space-x-2">
						<input
							type="checkbox"
							id="trust-device"
							checked={trustDevice}
							onChange={(e) => setTrustDevice(e.target.checked)}
							className="h-4 w-4"
						/>
						<label htmlFor="trust-device" className="text-sm text-muted-foreground cursor-pointer">
							Trust this device for 30 days
						</label>
					</div>

					<div className="space-y-2">
						<Button
							type="button"
							className="w-full"
							loading={isVerifying2FA}
							onClick={handleVerify2FA}
							disabled={totpCode.length !== 6}
						>
							Verify
						</Button>
						<Button
							type="button"
							variant="outline"
							className="w-full"
							onClick={handleBackToLogin}
							disabled={isVerifying2FA}
						>
							Back to Login
						</Button>
					</div>
				</div>
			</AuthLayout>
		);
	}

	return (
		<AuthLayout title="Login to your account" description="Enter your credentials below to login to your account">
			<Form {...form}>
				<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
					<div className={cn("rounded-md border border-destructive/50 p-3 text-sm", { hidden: !errorDescription })}>
						{errorDescription}
					</div>
					<FormField
						control={form.control}
						name="username"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Username</FormLabel>
								<FormControl>
									<Input {...field} type="text" placeholder="admin" disabled={isLoggingIn} />
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

			{ssoProviders.providers.length > 0 && (
				<div className="pt-4 border-t border-border/60 space-y-3">
					<p className="text-sm font-medium">Alternative Sign-in</p>
					<div className="flex flex-col gap-2">
						{ssoProviders.providers.map((provider) => (
							<Button
								key={provider.providerId}
								type="button"
								variant="outline"
								className="w-full"
								loading={ssoLoginMutation.isPending}
								disabled={ssoLoginMutation.isPending}
								onClick={() => ssoLoginMutation.mutate(provider.providerId)}
							>
								Log in with {provider.providerId}
							</Button>
						))}
					</div>
				</div>
			)}

			<ResetPasswordDialog open={showResetDialog} onOpenChange={setShowResetDialog} />
		</AuthLayout>
	);
}
