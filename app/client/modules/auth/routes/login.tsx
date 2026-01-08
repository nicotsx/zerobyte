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
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "~/client/components/ui/input-otp";
import { Label } from "~/client/components/ui/label";
import { authClient } from "~/client/lib/auth-client";
import { authMiddleware } from "~/middleware/auth";
import { ResetPasswordDialog } from "../components/reset-password-dialog";
import type { Route } from "./+types/login";

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
	const [requires2FA, setRequires2FA] = useState(false);
	const [totpCode, setTotpCode] = useState("");
	const [isVerifying2FA, setIsVerifying2FA] = useState(false);
	const [trustDevice, setTrustDevice] = useState(false);

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

		if ("twoFactorRedirect" in data && data.twoFactorRedirect) {
			setRequires2FA(true);
			return;
		}

		const d = await authClient.getSession();
		if (data.user && !d.data?.user.hasDownloadedResticPassword) {
			void navigate("/download-recovery-key");
		} else {
			void navigate("/volumes");
		}
	};

	const handleVerify2FA = async () => {
		if (totpCode.length !== 6) {
			toast.error("Please enter a 6-digit code");
			return;
		}

		setIsVerifying2FA(true);

		const { data, error } = await authClient.twoFactor.verifyTotp({
			code: totpCode,
			trustDevice,
		});

		setIsVerifying2FA(false);

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
				void navigate("/download-recovery-key");
			} else {
				void navigate("/volumes");
			}
		}
	};

	const handleBackToLogin = () => {
		setRequires2FA(false);
		setTotpCode("");
		setTrustDevice(false);
		form.reset();
	};

	if (requires2FA) {
		return (
			<AuthLayout title="Two-Factor Authentication" description="Enter the 6-digit code from your authenticator app">
				<div className="space-y-6">
					<div className="space-y-4 flex flex-col items-center">
						<Label htmlFor="totp-code text-center">Authentication code</Label>
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

			<ResetPasswordDialog open={showResetDialog} onOpenChange={setShowResetDialog} />
		</AuthLayout>
	);
}
