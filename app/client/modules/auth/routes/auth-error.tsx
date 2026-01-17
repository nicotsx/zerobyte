import { AlertCircle } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { AuthLayout } from "~/client/components/auth-layout";
import { Button } from "~/client/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "~/client/components/ui/alert";
import type { Route } from "./+types/auth-error";

export function meta(_: Route.MetaArgs) {
	return [{ title: "Authentication Error - Zerobyte" }];
}

export default function AuthErrorPage() {
	const [searchParams] = useSearchParams();
	const errorMessage = searchParams.get("error") || "An unknown error occurred";

	const formattedError = errorMessage
		.split(/[_-]/)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");

	return (
		<AuthLayout title="Authentication Error" description="An error occurred during authentication">
			<Alert variant="destructive">
				<AlertCircle className="h-4 w-4" />
				<AlertTitle>Error</AlertTitle>
				<AlertDescription>{formattedError}</AlertDescription>
			</Alert>

			<div className="flex flex-col gap-2">
				<Button>
					<Link to="/login">Back to Login</Link>
				</Button>
			</div>
		</AuthLayout>
	);
}
