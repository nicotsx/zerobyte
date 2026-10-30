import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { STORED_SECRET } from "~/lib/stored-secret";

import { cn } from "~/client/lib/utils";
import { Button, buttonVariants } from "./button";
import { Input } from "./input";
import { Textarea } from "./textarea";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "./alert-dialog";

type SecretInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement | HTMLTextAreaElement>, "type" | "onChange"> & {
	onChange?: (value: string) => void;
	allowClear?: boolean;
	multiline?: boolean;
	rows?: number;
	ref?: React.Ref<HTMLInputElement | HTMLTextAreaElement>;
};

export const SecretInput = ({
	className,
	value,
	onChange,
	allowClear = false,
	multiline = false,
	rows = 6,
	ref,
	...props
}: SecretInputProps) => {
	const [revealed, setRevealed] = useState(false);
	const [replacing, setReplacing] = useState(false);
	const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
	const stored = value === STORED_SECRET;
	const canKeepStored = replacing && (stored || value === "");
	const editable = !props.disabled && !props.readOnly && onChange !== undefined;
	const reference = typeof value === "string" && (value.startsWith("env://") || value.startsWith("file://"));
	const setRef = (element: HTMLInputElement | HTMLTextAreaElement | null) => {
		inputRef.current = element;
		if (typeof ref === "function") ref(element);
		else if (ref) ref.current = element;
	};

	useEffect(() => {
		if (stored && replacing) inputRef.current?.focus();
	}, [stored, replacing]);

	if (stored && !replacing) {
		return (
			<div className="relative" data-secret-input>
				<div
					className={cn(
						"flex h-9 items-center gap-2 rounded-none border border-input bg-transparent pl-3 pr-1 dark:bg-input/30",
						className,
					)}
				>
					<LockKeyhole className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<Input
						{...props}
						ref={setRef}
						value="Stored credential"
						readOnly
						className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
					/>
					<Button
						type="button"
						size="sm"
						className="h-7 shrink-0 rounded-none"
						variant="ghost"
						disabled={!editable}
						onClick={() => {
							setRevealed(false);
							setReplacing(true);
						}}
					>
						Replace
					</Button>
					{allowClear && (
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button
									type="button"
									size="sm"
									variant="ghost"
									disabled={!editable}
									className="h-7 shrink-0 rounded-none text-destructive hover:text-destructive"
								>
									Clear
								</Button>
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>Clear stored credential?</AlertDialogTitle>
									<AlertDialogDescription>
										This removes the credential when you save your changes. Connections that require
										it may stop working. You will need to enter it again to use it later.
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>Keep credential</AlertDialogCancel>
									<AlertDialogAction
										className={buttonVariants({ variant: "destructive" })}
										disabled={!editable}
										onClick={() => {
											setRevealed(false);
											setReplacing(false);
											onChange?.("");
										}}
									>
										Clear credential
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					)}
				</div>
			</div>
		);
	}

	const displayedValue = stored ? "" : value;
	const changeValue = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
		onChange?.(event.target.value);

	return (
		<div className="relative" data-secret-input>
			<div className="relative">
				{multiline ? (
					<Textarea
						{...props}
						ref={setRef}
						rows={rows}
						value={displayedValue}
						onChange={changeValue}
						className={cn(
							"rounded-none font-mono text-xs",
							canKeepStored && "pr-36",
							!revealed && !reference && "[-webkit-text-security:disc]",
							className,
						)}
					/>
				) : (
					<Input
						{...props}
						ref={setRef}
						value={displayedValue}
						onChange={changeValue}
						type={revealed || reference ? "text" : "password"}
						className={cn("rounded-none", !reference && "pr-10", canKeepStored && "pr-36", className)}
					/>
				)}
				{!reference && (
					<Button
						type="button"
						variant="ghost"
						size="icon"
						disabled={props.disabled}
						className={cn(
							"absolute right-1 top-1 size-7 rounded-none",
							canKeepStored && "right-28",
							multiline && "bg-background",
						)}
						onClick={() => setRevealed((v) => !v)}
						aria-label={revealed ? "Hide secret" : "Show secret"}
					>
						{revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
					</Button>
				)}
			</div>
			{canKeepStored && (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="absolute right-1 top-1 h-7 rounded-none"
					disabled={!editable}
					onClick={() => {
						setReplacing(false);
						onChange?.(STORED_SECRET);
					}}
				>
					Keep stored
				</Button>
			)}
		</div>
	);
};
