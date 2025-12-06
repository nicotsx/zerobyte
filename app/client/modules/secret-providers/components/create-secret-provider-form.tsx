import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Button } from "~/client/components/ui/button";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { SecretInput } from "~/client/components/ui/secret-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Switch } from "~/client/components/ui/switch";
import {
	SECRET_PROVIDER_METADATA,
	type SecretProviderType,
	type ProviderFieldConfig,
} from "~/schemas/secrets";

// Base fields that are always present
interface SecretProviderFormBase {
	name: string;
	type: SecretProviderType;
	enabled: boolean;
	customPrefix?: string;
}

// Form values type with dynamic provider fields
export type SecretProviderFormValues = SecretProviderFormBase & {
	[key: string]: string | boolean | undefined;
};

interface CreateSecretProviderFormProps {
	mode: "create" | "edit";
	formId: string;
	onSubmit: (values: SecretProviderFormValues) => void;
	onDirtyChange?: (isDirty: boolean) => void;
	onTestConnection?: (values: SecretProviderFormValues) => void;
	isTestingConnection?: boolean;
	defaultValues?: Partial<SecretProviderFormValues>;
}

/**
 * Build default values from all provider field configs
 */
function buildDefaultValues(): Record<string, string | boolean> {
	const defaults: Record<string, string | boolean> = {};
	for (const provider of Object.values(SECRET_PROVIDER_METADATA)) {
		for (const field of provider.fields) {
			if (field.type === "switch") {
				defaults[field.name] = field.defaultValue ?? true;
			} else {
				defaults[field.name] = (field.defaultValue as string) ?? "";
			}
		}
	}
	return defaults;
}

/**
 * Render a single field based on its configuration
 */
function ProviderField({
	field,
	mode,
	form,
	providerType,
}: {
	field: ProviderFieldConfig;
	mode: "create" | "edit";
	form: ReturnType<typeof useForm<SecretProviderFormValues>>;
	providerType: SecretProviderType;
}) {
	const helpText = mode === "edit" && field.editHelpText ? field.editHelpText : field.helpText;
	const placeholder = mode === "edit" && field.editPlaceholder ? field.editPlaceholder : field.placeholder;
	// Use field.name directly - the index signature allows any string key
	const fieldName = field.name;

	switch (field.type) {
		case "url":
		case "text":
			return (
				<div className="space-y-2">
					<Label htmlFor={fieldName}>{field.label}</Label>
					<Input
						id={fieldName}
						type={field.type === "url" ? "url" : "text"}
						placeholder={placeholder}
						{...form.register(fieldName, { required: field.required && providerType === form.watch("type") })}
					/>
					{helpText && <p className="text-xs text-muted-foreground">{helpText}</p>}
				</div>
			);

		case "secret":
			return (
				<div className="space-y-2">
					<Label htmlFor={fieldName}>{field.label}</Label>
					<SecretInput
						id={fieldName}
						placeholder={placeholder}
						value={(form.watch(fieldName) as string) ?? ""}
						onChange={(e) => form.setValue(fieldName, e.target.value, { shouldDirty: true })}
						builtInOnly
					/>
					{helpText && <p className="text-xs text-muted-foreground">{helpText}</p>}
				</div>
			);

		case "switch":
			return (
				<div className="flex items-center justify-between">
					<div className="space-y-0.5">
						<Label htmlFor={fieldName}>{field.label}</Label>
						{helpText && <p className="text-xs text-muted-foreground">{helpText}</p>}
					</div>
					<Switch
						id={fieldName}
						checked={(form.watch(fieldName) as boolean) ?? true}
						onCheckedChange={(checked) => form.setValue(fieldName, checked, { shouldDirty: true })}
					/>
				</div>
			);

		default:
			return null;
	}
}

export function CreateSecretProviderForm({
	mode,
	formId,
	onSubmit,
	onDirtyChange,
	onTestConnection,
	isTestingConnection,
	defaultValues,
}: CreateSecretProviderFormProps) {
	const providerTypes = Object.keys(SECRET_PROVIDER_METADATA) as SecretProviderType[];

	// Guard against empty provider metadata (developer error)
	if (providerTypes.length === 0) {
		return <div className="text-muted-foreground">No secret providers available.</div>;
	}

	const defaultType = providerTypes[0];
	const form = useForm<SecretProviderFormValues>({
		defaultValues: {
			name: "",
			type: defaultType,
			enabled: true,
			customPrefix: "",
			...buildDefaultValues(),
			...defaultValues,
		},
	});

	const isDirty = form.formState.isDirty;
	const providerType = form.watch("type");
	const providerMeta = SECRET_PROVIDER_METADATA[providerType];

	useEffect(() => {
		onDirtyChange?.(isDirty);
	}, [isDirty, onDirtyChange]);

	const handleSubmit = form.handleSubmit((values) => {
		onSubmit(values);
	});

	return (
		<form id={formId} onSubmit={handleSubmit} className="space-y-6">
			{/* Common fields */}
			<div className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="name">Name</Label>
					<Input
						id="name"
						placeholder="e.g., Production Secrets Provider"
						{...form.register("name", { required: true })}
					/>
					<p className="text-xs text-muted-foreground">A friendly name to identify this provider</p>
				</div>

				<div className="space-y-2">
					<Label htmlFor="type">Provider Type</Label>
					<Select
						value={providerType}
						onValueChange={(value: SecretProviderType) => form.setValue("type", value)}
						disabled={mode === "edit"}
					>
						<SelectTrigger>
							<SelectValue placeholder="Select provider type" />
						</SelectTrigger>
						<SelectContent>
							{(Object.entries(SECRET_PROVIDER_METADATA) as [SecretProviderType, typeof providerMeta][]).map(
								([type, meta]) => (
									<SelectItem key={type} value={type}>
										<div className="flex flex-col items-start">
											<span>{meta.label}</span>
											<span className="text-xs text-muted-foreground">{meta.description}</span>
										</div>
									</SelectItem>
								),
							)}
						</SelectContent>
					</Select>
				</div>

				<div className="space-y-2">
					<Label htmlFor="customPrefix">URI Prefix</Label>
					<Input
						id="customPrefix"
						placeholder={providerMeta.defaultPrefix}
						{...form.register("customPrefix")}
					/>
					<p className="text-xs text-muted-foreground">
						Secrets will be referenced as{" "}
						<code className="bg-muted px-1 rounded">{providerMeta.uriExample}</code>
					</p>
				</div>

				{mode === "edit" && (
					<div className="flex items-center justify-between">
						<div className="space-y-0.5">
							<Label htmlFor="enabled">Enabled</Label>
							<p className="text-xs text-muted-foreground">Disable to temporarily stop using this provider</p>
						</div>
						<Switch
							id="enabled"
							checked={form.watch("enabled")}
							onCheckedChange={(checked) => form.setValue("enabled", checked, { shouldDirty: true })}
						/>
					</div>
				)}
			</div>

			{/* Provider-specific fields - dynamically rendered */}
			<div className="border-t pt-6">
				<h4 className="text-sm font-medium mb-4">{providerMeta.label} Configuration</h4>

				<div className="space-y-4">
					{providerMeta.fields.map((field) => (
						<ProviderField
							key={field.name}
							field={field}
							mode={mode}
							form={form}
							providerType={providerType}
						/>
					))}
				</div>

				{/* Test button - only shown in create mode */}
				{mode === "create" && onTestConnection && (
					<div className="pt-4">
						<Button
							type="button"
							variant="outline"
							onClick={() => onTestConnection(form.getValues())}
							loading={isTestingConnection}
						>
							Test Connection
						</Button>
					</div>
				)}
			</div>
		</form>
	);
}
