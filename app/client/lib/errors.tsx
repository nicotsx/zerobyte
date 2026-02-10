import { toast } from "sonner";
import { unlockRepository } from "~/client/api-client/sdk.gen";
import { Button } from "~/client/components/ui/button";
import { Unlock } from "lucide-react";

export const isLockError = (error: unknown): boolean => {
	const errorMessage = parseError(error)?.message || "";

	return (
		errorMessage.toLowerCase().includes("unable to create lock") ||
		errorMessage.toLowerCase().includes("repository is already locked") ||
		errorMessage.toLowerCase().includes("failed to lock repository")
	);
};

export const parseError = (error?: unknown) => {
	if (error && typeof error === "object" && "message" in error) {
		return { message: error.message as string };
	}

	if (typeof error === "string") {
		return { message: error };
	}

	return undefined;
};

export const showLockErrorToast = (repositoryId: string, title: string) => {
	toast.error(title, {
		description:
			"The repository is currently locked by another operation. This can happen when a previous operation didn't complete properly.",
		duration: 5000,
		action: (
			<Button
				size="sm"
				variant="outline"
				onClick={() => {
					toast.dismiss();
					toast.promise(
						async () => {
							const result = await unlockRepository({
								path: { id: repositoryId },
								throwOnError: true,
							});
							return result.data;
						},
						{
							loading: "Unlocking repository...",
							success: "Repository unlocked successfully! You can now retry your operation.",
							error: (err) => parseError(err)?.message || "Failed to unlock repository",
						},
					);
				}}
			>
				<Unlock className="h-3 w-3 mr-1" />
				Unlock
			</Button>
		),
	});
};

export const handleRepositoryError = (title: string, error: unknown, repositoryId: string) => {
	if (isLockError(error)) {
		showLockErrorToast(repositoryId, title);
		return null;
	}

	toast.error(parseError(error)?.message || "An unexpected error occurred");

	return null;
};
