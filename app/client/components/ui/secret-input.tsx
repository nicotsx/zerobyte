import { Eye, EyeOff } from "lucide-react";
import type * as React from "react";
import { useMemo, useState } from "react";

import { cn } from "~/client/lib/utils";
import { Button } from "./button";
import { Input } from "./input";

export const isStoredSecretValue = (value?: string): boolean => {
	if (typeof value !== "string" || value.length === 0) {
		return false;
	}

	return value.startsWith("env://") || value.startsWith("file://") || value.startsWith("encv1:");
};

type SecretInputProps = Omit<React.ComponentProps<typeof Input>, "type">

export const SecretInput = ({ className, value, ...props }: SecretInputProps) => {
	const [revealed, setRevealed] = useState(false);

	const showAsPlaintext = useMemo(() => {
		if (typeof value !== "string") {
			return false;
		}

		return isStoredSecretValue(value);
	}, [value]);

	const type = useMemo(() => {
		if (showAsPlaintext) {
			return "text";
		}
		return revealed ? "text" : "password";
	}, [showAsPlaintext, revealed]);

	return (
		<div className="relative" data-secret-input>
			<Input
				{...props}
				value={value}
				type={type}
				className={cn(!showAsPlaintext && "pr-10", className)}
			/>
			{!showAsPlaintext && (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="absolute right-1 top-1/2 size-7 -translate-y-1/2"
					onClick={() => setRevealed((v) => !v)}
					aria-label={revealed ? "Hide secret" : "Show secret"}
				>
					{revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
				</Button>
			)}
		</div>
	);
};
