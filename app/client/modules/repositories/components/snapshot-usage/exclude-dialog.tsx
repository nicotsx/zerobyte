import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Copy } from "lucide-react";
import { normalizeAbsolutePath } from "@zerobyte/core/utils";
import { addExcludePatternsMutation } from "~/client/api-client/@tanstack/react-query.gen";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/client/components/ui/dialog";
import { Button } from "~/client/components/ui/button";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/client/components/ui/tooltip";
import { ByteSize } from "~/client/components/bytes-size";
import { cn } from "~/client/lib/utils";
import { parseError } from "~/client/lib/errors";
import { createPathPrefixFns } from "~/client/lib/volume-path";
import type { SnapshotUsageEntry } from "~/schemas/snapshot-usage";
import { buildExcludePatternChoices } from "./exclude-patterns";

type OwningSchedule = {
	shortId: string;
	name: string;
	excludePatterns: string[] | null;
};

type Props = {
	entry: SnapshotUsageEntry | null;
	schedule: OwningSchedule | null;
	/** The volume's mount path, so paths can be shown relative to it instead of the host filesystem. */
	displayBasePath?: string;
	onClose: () => void;
};

export const ExcludeDialog = ({ entry, schedule, displayBasePath, onClose }: Props) => {
	const displayPathFns = useMemo(
		() => createPathPrefixFns(normalizeAbsolutePath(displayBasePath ?? "/")),
		[displayBasePath],
	);
	const choices = useMemo(
		() => (entry ? buildExcludePatternChoices(entry, (path) => displayPathFns.strip(path)) : []),
		[entry, displayPathFns],
	);
	const [pattern, setPattern] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);

	useEffect(() => {
		const first = choices[0];
		if (!first) return;

		setPattern(first.pattern);
		setSelectedId(first.id);
	}, [choices]);

	const addExclusion = useMutation({
		...addExcludePatternsMutation(),
		onSuccess: () => {
			toast.success("Exclusion added", {
				description: "It applies from the next backup. Existing snapshots still hold the data.",
			});
			onClose();
		},
		onError: (error) => {
			toast.error("Failed to add the exclusion", { description: parseError(error)?.message });
		},
	});

	if (!entry) return null;

	const existing = schedule?.excludePatterns ?? [];
	const alreadyExcluded = existing.some((value) => value.trim() === pattern.trim());

	const handleApply = () => {
		if (!schedule || !pattern.trim() || alreadyExcluded) return;

		// Merged server-side so this cannot clobber a concurrent edit, or reset
		// unrelated schedule fields.
		addExclusion.mutate({
			path: { shortId: schedule.shortId },
			body: { patterns: [pattern.trim()] },
		});
	};

	const handleCopy = () => {
		void navigator.clipboard?.writeText(pattern).then(
			() => toast.success("Pattern copied"),
			() => toast.error("Could not copy the pattern"),
		);
	};

	const selectChoice = (choice: (typeof choices)[number]) => {
		setPattern(choice.pattern);
		setSelectedId(choice.id);
	};

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Exclude from future backups</DialogTitle>
					<DialogDescription>
						<span className="font-mono break-all">{displayPathFns.strip(entry.path)}</span>
						{" — "}
						<ByteSize bytes={entry.size} />
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<fieldset className="space-y-2">
						<legend className="sr-only">Suggested exclude patterns</legend>
						{choices.map((choice) => (
							<label
								key={choice.id}
								className={cn(
									"block w-full cursor-pointer rounded-md border p-3 transition-colors hover:bg-accent has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
									selectedId === choice.id ? "border-primary bg-accent" : "border-border",
								)}
							>
								<input
									type="radio"
									name="exclude-pattern-choice"
									value={choice.id}
									checked={selectedId === choice.id}
									onChange={() => selectChoice(choice)}
									className="sr-only"
								/>
								<div className="text-sm font-medium">{choice.label}</div>
								<div className="mt-1 font-mono text-xs break-all text-muted-foreground">
									{choice.pattern}
								</div>
								<div className="mt-1 text-xs text-muted-foreground">{choice.description}</div>
							</label>
						))}
					</fieldset>

					<div className="space-y-2">
						<Label htmlFor="exclude-pattern">Pattern</Label>
						<div className="flex gap-2">
							<Input
								id="exclude-pattern"
								value={pattern}
								onChange={(event) => {
									setPattern(event.target.value);
									setSelectedId(null);
								}}
								aria-describedby={alreadyExcluded ? "exclude-pattern-hint" : undefined}
								className="font-mono text-sm"
							/>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="outline"
										size="icon"
										onClick={handleCopy}
										disabled={!pattern.trim()}
										aria-label="Copy pattern"
									>
										<Copy className="h-4 w-4" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Copy pattern</TooltipContent>
							</Tooltip>
						</div>
						{alreadyExcluded && (
							<output id="exclude-pattern-hint" className="block text-xs text-muted-foreground">
								This pattern is already on the schedule.
							</output>
						)}
					</div>

					{schedule ? (
						<p className="text-xs text-muted-foreground">
							Adds to <span className="font-medium">{schedule.name}</span>, which currently has{" "}
							{existing.length} exclusion{existing.length === 1 ? "" : "s"}. Takes effect on the next
							backup — snapshots already taken still contain this data until they are forgotten and
							pruned.
						</p>
					) : (
						<p className="text-xs text-muted-foreground">
							This snapshot is not linked to a backup job in Zerobyte, so the pattern cannot be applied
							automatically. Copy it into the job's exclusion list yourself.
						</p>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button
						variant="destructive"
						onClick={handleApply}
						disabled={!schedule || !pattern.trim() || alreadyExcluded || addExclusion.isPending}
						loading={addExclusion.isPending}
					>
						<Ban className="h-4 w-4 mr-2" />
						Exclude
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
