import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play, Loader2, Trash2, Terminal } from "lucide-react";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "./ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { listRepositoriesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { devPanelExec } from "~/client/api-client/sdk.gen";
import { parseError } from "../lib/errors";

type DevPanelProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

type SseOutputEvent = {
	type: "stdout" | "stderr";
	line: string;
};

type SseDoneEvent = {
	type: "done";
	exitCode: number;
};

type SseErrorEvent = {
	type: "error";
	message: string;
};

type SseEvent = SseOutputEvent | SseDoneEvent | SseErrorEvent;

export function DevPanel({ open, onOpenChange }: DevPanelProps) {
	const { data: repositories = [] } = useQuery({
		...listRepositoriesOptions(),
		enabled: open,
	});

	const [selectedRepoId, setSelectedRepoId] = useState<string>("");
	const [commandLine, setCommandLine] = useState("snapshots");
	const [output, setOutput] = useState<string[]>([]);
	const [isRunning, setIsRunning] = useState(false);
	const abortControllerRef = useRef<AbortController | null>(null);
	const outputRef = useRef<HTMLDivElement>(null);

	const scrollToBottom = useCallback(() => {
		if (outputRef.current) {
			outputRef.current.scrollTop = outputRef.current.scrollHeight;
		}
	}, []);

	const appendOutput = useCallback(
		(line: string) => {
			setOutput((prev) => {
				const newOutput = [...prev, line];
				setTimeout(scrollToBottom, 0);
				return newOutput;
			});
		},
		[scrollToBottom],
	);

	const handleRun = async () => {
		if (!selectedRepoId || !commandLine.trim()) {
			return;
		}

		setOutput([]);
		setIsRunning(true);
		appendOutput(`$ restic ${commandLine}`.trim());
		appendOutput("---");

		abortControllerRef.current = new AbortController();

		// Parse command line: first word is command, rest are args
		const trimmedLine = commandLine.trim();
		const parts = trimmedLine.split(/\s+/);
		const command = parts[0];
		const argsArray = parts.slice(1);

		try {
			const result = await devPanelExec({
				path: { id: selectedRepoId },
				body: { command, args: argsArray.length > 0 ? argsArray : undefined },
				signal: abortControllerRef.current.signal,
			});

			for await (const event of result.stream) {
				if (abortControllerRef.current.signal.aborted) {
					break;
				}
				const data = event as unknown as SseEvent;

				if (!data || typeof data !== "object") {
					continue;
				}

				if (data.type === "stdout" || data.type === "stderr") {
					appendOutput(data.line);
				} else if (data.type === "done") {
					appendOutput(`---`);
					appendOutput(`Command finished with exit code: ${data.exitCode}`);
				} else if (data.type === "error") {
					appendOutput(`Error: ${data.message}`);
				}
			}
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") {
				appendOutput("---");
				appendOutput("Command cancelled");
			} else {
				appendOutput(`Error: ${parseError(err)?.message}`);
			}
		} finally {
			setIsRunning(false);
			abortControllerRef.current = null;
		}
	};

	const handleCancel = () => {
		abortControllerRef.current?.abort();
	};

	const handleClear = () => {
		setOutput([]);
	};

	const handleClose = () => {
		if (isRunning) {
			handleCancel();
		}
		onOpenChange(false);
	};

	return (
		<Sheet open={open} onOpenChange={handleClose}>
			<SheetContent side="right" className="w-full sm:max-w-xl flex flex-col px-4">
				<SheetHeader>
					<SheetTitle className="flex items-center gap-2">
						<Terminal className="h-5 w-5" />
						Dev Panel
					</SheetTitle>
					<SheetDescription>Execute restic commands against a repository</SheetDescription>
				</SheetHeader>

				<div className="flex flex-col gap-4 flex-1 min-h-0 mt-4">
					<div className="grid gap-4">
						<div className="grid gap-2">
							<Label htmlFor="repository">Repository</Label>
							<Select value={selectedRepoId} onValueChange={setSelectedRepoId}>
								<SelectTrigger id="repository">
									<SelectValue placeholder="Select a repository" />
								</SelectTrigger>
								<SelectContent>
									{repositories.map((repo) => (
										<SelectItem key={repo.id} value={repo.id}>
											{repo.name} ({repo.type})
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="grid gap-2">
							<Label htmlFor="command">Command</Label>
							<Textarea
								id="command"
								placeholder="e.g., snapshots, check --dry-run, forget --keep-last 10"
								value={commandLine}
								onChange={(e) => setCommandLine(e.target.value)}
								className="font-mono text-sm"
								rows={2}
							/>
						</div>

						<div className="flex gap-2">
							<Button onClick={handleRun} disabled={isRunning || !selectedRepoId || !commandLine.trim()}>
								{isRunning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
								{isRunning ? "Running..." : "Run"}
							</Button>
							{isRunning && (
								<Button variant="destructive" onClick={handleCancel}>
									Cancel
								</Button>
							)}
							<Button variant="outline" onClick={handleClear} disabled={isRunning}>
								<Trash2 className="h-4 w-4 mr-2" />
								Clear
							</Button>
						</div>
					</div>

					<div className="flex-1 min-h-0 border rounded-md bg-muted/30">
						<div ref={outputRef} className="h-full overflow-auto p-3 font-mono text-xs">
							{output.length === 0 ? (
								<div className="text-muted-foreground">Output will appear here...</div>
							) : (
								<div className="space-y-0.5">
									{output.map((line, i) => {
										let displayLine = line;
										let isJson = false;
										try {
											const parsed = JSON.parse(line);
											displayLine = JSON.stringify(parsed, null, 2);
											isJson = true;
										} catch {
											// Not valid JSON, display as-is
										}
										return (
											<pre
												key={`${i}-${line.slice(0, 20)}`}
												className={
													isJson
														? "whitespace-pre wrap-break-word text-[10px] leading-tight"
														: "whitespace-pre-wrap break-all text-xs"
												}
											>
												{displayLine}
											</pre>
										);
									})}
								</div>
							)}
						</div>
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}
