import * as React from "react";
import { Eye, EyeOff, KeyRound, Search } from "lucide-react";
import { cn } from "~/client/lib/utils";
import { Button } from "./button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { useSecretSchemes } from "~/client/hooks/use-secret-schemes";
import { isSecretRef, isEncryptedSecret } from "~/client/lib/secrets";

// Lazy import for the browser dialog to avoid circular dependencies
const LazySecretBrowserDialog = React.lazy(() =>
	import("./secret-browser-dialog").then((mod) => ({ default: mod.SecretBrowserDialog })),
);

export interface SecretInputProps extends Omit<React.ComponentProps<"input">, "type"> {
	/** Whether to show plain text (for secret URIs) or mask the value */
	revealable?: boolean;
	/** Whether to show the browse button to open secret browser dialog */
	browsable?: boolean;
	/** Only show built-in providers (env://, file://) in browser - useful for bootstrap credentials */
	builtInOnly?: boolean;
}

/**
 * SecretInput - An input component for sensitive values that may be secret URIs
 *
 * Features:
 * - Detects if value is a secret URI (e.g., provider://path/to/secret) based on registered schemes
 * - Detects encrypted secrets (encv1:...)
 * - Shows lock icon for secret references
 * - Secret references are shown in plain text (they're references, not actual secrets)
 * - Plain text secrets can be toggled between visible/hidden with eye icon
 * - Built-in browse button to open secret browser dialog
 */
function SecretInput({
	className,
	value,
	revealable = true,
	browsable = true,
	builtInOnly = false,
	onChange,
	...props
}: SecretInputProps) {
	const [showPassword, setShowPassword] = React.useState(false);
	const [browserOpen, setBrowserOpen] = React.useState(false);
	const { schemes } = useSecretSchemes();

	const stringValue = typeof value === "string" ? value : value?.toString() ?? "";
	const isUri = isSecretRef(stringValue, schemes);
	const isEncrypted = isEncryptedSecret(stringValue);

	// Secret URIs are always shown (they're references, not actual secrets)
	// Encrypted secrets are always shown (the encv1:... string is not sensitive)
	// Plain values can be toggled if revealable is true
	const inputType = isUri || isEncrypted || showPassword ? "text" : "password";

	// Show key icon only for secret URIs (not for encrypted values)
	// Show eye icon only for plain values that are revealable
	const showKeyIcon = isUri;
	const showEyeIcon = !isUri && !isEncrypted && revealable;
	const hasRightIcon = showKeyIcon || showEyeIcon;

	const handleSelect = (uri: string) => {
		if (onChange) {
			const syntheticEvent = {
				target: { value: uri },
			} as React.ChangeEvent<HTMLInputElement>;
			onChange(syntheticEvent);
		}
	};

	return (
		<>
			<div className="flex">
				<div className="relative flex-1">
					<input
					type={inputType}
					data-slot="input"
					value={value}
					onChange={onChange}
					className={cn(
						"file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
						"focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
						"aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
						// Add padding for icon on the right
						hasRightIcon && "pr-9",
						// Adjust border radius when browse button is shown
						browsable && "rounded-r-none",
						className,
					)}
					{...props}
				/>

				{/* Secret URI indicator - only for secret references, not encrypted values */}
				{showKeyIcon && (
					<Tooltip>
						<TooltipTrigger asChild>
							<div className="absolute right-2 top-1/2 -translate-y-1/2 text-primary">
								<KeyRound className="h-4 w-4" />
							</div>
						</TooltipTrigger>
						<TooltipContent>
							<p>Secret reference - value will be resolved at runtime</p>
						</TooltipContent>
					</Tooltip>
				)}

				{/* Show/hide toggle for non-URI values */}
				{showEyeIcon && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="absolute right-0 top-0 h-full px-2 hover:bg-transparent"
						onClick={() => setShowPassword(!showPassword)}
						tabIndex={-1}
					>
						{showPassword ? (
							<EyeOff className="h-4 w-4 text-muted-foreground" />
						) : (
							<Eye className="h-4 w-4 text-muted-foreground" />
						)}
						<span className="sr-only">{showPassword ? "Hide" : "Show"} password</span>
					</Button>
				)}
			</div>

			{/* Browse button */}
				{browsable && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="outline"
								size="icon"
								className="h-9 w-9 shrink-0 rounded-l-none border-l-0"
								onClick={() => setBrowserOpen(true)}
								tabIndex={-1}
							>
								<Search className="h-4 w-4" />
								<span className="sr-only">Browse secrets</span>
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							<p>Browse secret providers</p>
						</TooltipContent>
					</Tooltip>
				)}
			</div>

			{/* Browser dialog */}
			{browserOpen && (
				<React.Suspense fallback={null}>
					<LazySecretBrowserDialog
						open={browserOpen}
						onOpenChange={setBrowserOpen}
						onSelect={handleSelect}
						builtInOnly={builtInOnly}
						selectable
					/>
				</React.Suspense>
			)}
		</>
	);
}

export interface SecretTextareaProps extends Omit<React.ComponentProps<"textarea">, "type"> {
	/** Whether to show the browse button to open secret browser dialog */
	browsable?: boolean;
	/** Only show built-in providers (env://, file://) in browser - useful for bootstrap credentials */
	builtInOnly?: boolean;
}

/**
 * SecretTextarea - A textarea component for sensitive multi-line values that may be secret URIs
 *
 * Features:
 * - Detects if value is a secret URI (e.g., provider://path/to/secret) based on registered schemes
 * - Detects encrypted secrets (encv1:...)
 * - Shows lock icon for secret references
 * - Secret references are shown in plain text (they're references, not actual secrets)
 * - Built-in browse button to open secret browser dialog
 */
function SecretTextarea({
	className,
	value,
	browsable = true,
	builtInOnly = false,
	onChange,
	...props
}: SecretTextareaProps) {
	const [browserOpen, setBrowserOpen] = React.useState(false);
	const { schemes } = useSecretSchemes();

	const stringValue = typeof value === "string" ? value : value?.toString() ?? "";
	const isUri = isSecretRef(stringValue, schemes);

	// Show key icon only for secret URIs (not for encrypted values)
	const showKeyIcon = isUri;

	const handleSelect = (uri: string) => {
		if (onChange) {
			const syntheticEvent = {
				target: { value: uri },
			} as React.ChangeEvent<HTMLTextAreaElement>;
			onChange(syntheticEvent);
		}
	};

	return (
		<>
			<div className="flex">
				<div className="relative flex-1">
					<textarea
						data-slot="textarea"
						value={value}
						onChange={onChange}
						className={cn(
							"border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
							// Add padding for icon on the top right
							showKeyIcon && "pr-9",
							// Adjust border radius when browse button is shown
							browsable && "rounded-r-none",
							className,
						)}
						{...props}
					/>

					{/* Secret URI indicator - only for secret references, not encrypted values */}
					{showKeyIcon && (
						<Tooltip>
							<TooltipTrigger asChild>
								<div className="absolute right-2 top-2 text-primary">
									<KeyRound className="h-4 w-4" />
								</div>
							</TooltipTrigger>
							<TooltipContent>
								<p>Secret reference - value will be resolved at runtime</p>
							</TooltipContent>
						</Tooltip>
					)}
				</div>

				{/* Browse button */}
				{browsable && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="outline"
								size="icon"
								className="h-9 w-9 shrink-0 rounded-l-none border-l-0"
								onClick={() => setBrowserOpen(true)}
								tabIndex={-1}
							>
								<Search className="h-4 w-4" />
								<span className="sr-only">Browse secrets</span>
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							<p>Browse secret providers</p>
						</TooltipContent>
					</Tooltip>
				)}
			</div>

			{/* Browser dialog */}
			{browserOpen && (
				<React.Suspense fallback={null}>
					<LazySecretBrowserDialog
						open={browserOpen}
						onOpenChange={setBrowserOpen}
						onSelect={handleSelect}
						builtInOnly={builtInOnly}
						selectable
					/>
				</React.Suspense>
			)}
		</>
	);
}

export { SecretInput, SecretTextarea };
