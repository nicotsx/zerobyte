import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Loader2, MonitorCog } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	createRemoteAgentMutation,
	listAgentsOptions,
	rotateRemoteAgentTokenMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import type { CreateRemoteAgentResponse, ListAgentsResponse } from "~/client/api-client/types.gen";
import { Alert, AlertDescription, AlertTitle } from "~/client/components/ui/alert";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import { getMachineDisplayName } from "~/lib/machine-name";
import { CreateMachineForm, DeploymentInstructions } from "../components/machine-setup-forms";
import { MachineConnectionSuccess } from "../components/machine-connection-success";

type Agent = ListAgentsResponse[number];
type Enrollment = Pick<Agent, "id" | "credentialVersion" | "name"> & { issuedAt: number };

const steps = ["Name your machine", "Connect", "Connected"];

export function MachineSetupPage({ agentId }: { agentId?: string }) {
	const navigate = useNavigate();
	const [targetId, setTargetId] = useState(agentId);
	const [credential, setCredential] = useState<CreateRemoteAgentResponse | null>(null);
	const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
	const [connected, setConnected] = useState<Agent | null>(null);
	const [now, setNow] = useState(Date.now);

	const agentsQuery = useQuery({
		...listAgentsOptions(),
		refetchInterval: targetId && !connected ? 2_000 : false,
		refetchIntervalInBackground: false,
	});

	const target = agentsQuery.data?.find((agent) => agent.id === targetId && agent.kind === "remote");
	let currentStep = 0;
	if (targetId) currentStep = 1;
	if (connected) currentStep = 2;

	const headingRef = useRef<HTMLHeadingElement>(null);

	const acceptCredential = (result: CreateRemoteAgentResponse) => {
		setTargetId(result.agent.id);
		setEnrollment({
			id: result.agent.id,
			credentialVersion: result.agent.credentialVersion,
			name: result.agent.name,
			issuedAt: Date.now(),
		});
		setCredential(result);
		setNow(Date.now());
	};

	const createAgent = useMutation({
		...createRemoteAgentMutation(),
		gcTime: 0,
		onSuccess: (result) => {
			acceptCredential(result);
			createAgent.reset();
		},
	});

	const rotateCredential = useMutation({
		...rotateRemoteAgentTokenMutation(),
		gcTime: 0,
		onSuccess: (result) => {
			acceptCredential(result);
			rotateCredential.reset();
		},
	});

	useEffect(() => {
		headingRef.current?.focus();
	}, [currentStep]);

	useEffect(() => {
		if (!credential) return;

		const interval = window.setInterval(() => setNow(Date.now()), 1_000);
		return () => window.clearInterval(interval);
	}, [credential]);

	if (
		enrollment &&
		target &&
		!agentsQuery.isError &&
		target.revokedAt === null &&
		target.credentialVersion === enrollment.credentialVersion + 1 &&
		target.status === "online"
	) {
		setConnected(target);
		setCredential(null);
		setEnrollment(null);
	}

	const backToMachines = () =>
		void navigate({ to: "/settings", search: { scope: "organization" }, hash: "machines" });
	const replaceCode = () => {
		setCredential(null);
		setEnrollment(null);
		rotateCredential.reset();
	};

	const hasFreshStatus = agentsQuery.isSuccess;
	const consumed = !!enrollment && !!target && target.credentialVersion === enrollment.credentialVersion + 1;
	const expired = !!credential && now >= credential.expiresAt && !consumed;
	const replaced = !!enrollment && !!target && target.credentialVersion > enrollment.credentialVersion + 1;
	const unavailable =
		hasFreshStatus &&
		!!enrollment &&
		((!target && agentsQuery.dataUpdatedAt >= enrollment.issuedAt) || target?.revokedAt != null || replaced);
	const canDeploy = credential && !expired && !unavailable;
	const machineName = getMachineDisplayName(connected?.name ?? enrollment?.name ?? target?.name ?? "");

	let title = "Connect Machine";
	if (currentStep === 1) title = "Reconnect your machine";
	if (currentStep === 1 && (target || enrollment)) title = `Connect ${machineName}`;
	if (connected) title = "Connection successful";

	return (
		<div className="container mx-auto space-y-6">
			<Card>
				<CardHeader>
					<div className="flex items-center gap-3">
						<div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
							<MonitorCog className="w-5 h-5 text-primary" aria-hidden="true" />
						</div>
						<CardTitle>
							<h1 ref={headingRef} tabIndex={-1} className="outline-none">
								{title}
							</h1>
						</CardTitle>
					</div>
					<CardDescription>
						Step {currentStep + 1} of {steps.length} · {steps[currentStep]}
					</CardDescription>
				</CardHeader>
				<CardContent className="min-w-0 space-y-6">
					{currentStep === 0 && (
						<CreateMachineForm
							pending={createAgent.isPending}
							failed={createAgent.isError}
							onCreate={(name) => createAgent.mutate({ body: { name } })}
							onCancel={backToMachines}
						/>
					)}

					{currentStep === 1 && (
						<>
							{agentsQuery.isError && (
								<Alert variant="destructive">
									<AlertTitle>Could not check the connection</AlertTitle>
									<AlertDescription>
										Check your connection to Zerobyte, then try again. Success will appear once the
										machine is ready.
									</AlertDescription>
									<Button
										variant="outline"
										className="mt-3"
										onClick={() => void agentsQuery.refetch()}
										loading={agentsQuery.isFetching}
									>
										Retry connection check
									</Button>
								</Alert>
							)}

							{!credential && (
								<>
									{agentsQuery.isPending && (
										<output className="block text-sm text-muted-foreground">
											Loading machine…
										</output>
									)}
									{hasFreshStatus && !target && (
										<Alert variant="destructive">
											<AlertTitle>Machine unavailable</AlertTitle>
											<AlertDescription>
												This machine no longer exists or belongs to another organization. Return
												to Settings to choose a machine.
											</AlertDescription>
										</Alert>
									)}
									{target && (
										<div className="space-y-5">
											<Alert variant="warning">
												<AlertTitle>Reconnect {machineName}</AlertTitle>
												<AlertDescription>
													This disconnects the machine until you finish setup. Reconnect
													between backup runs. Your folders and Sources will be kept.
												</AlertDescription>
											</Alert>
											{rotateCredential.isError && (
												<p role="alert" className="text-sm text-destructive">
													Could not get a new connection code. Try again.
												</p>
											)}
											<div className="flex justify-end gap-2 pt-4 border-t">
												<Button variant="secondary" onClick={backToMachines}>
													Cancel
												</Button>
												<Button
													disabled={!hasFreshStatus}
													loading={rotateCredential.isPending}
													onClick={() =>
														rotateCredential.mutate({ path: { agentId: target.id } })
													}
												>
													Get new connection code{" "}
													<ArrowRight className="ml-2" aria-hidden="true" />
												</Button>
											</div>
										</div>
									)}
								</>
							)}

							{(expired || unavailable) && (
								<Alert variant="warning">
									<AlertTitle>
										{expired ? "Connection code expired" : "Connection code no longer valid"}
									</AlertTitle>
									<AlertDescription>
										{expired && "Get a fresh code to continue connecting this machine."}
										{!expired &&
											"The machine was removed, revoked, or another connection code was issued. This code can no longer connect it."}
									</AlertDescription>
									{target && (
										<Button variant="outline" className="mt-3" onClick={replaceCode}>
											Reconnect machine
										</Button>
									)}
								</Alert>
							)}
							{credential && !expired && !unavailable && (
								<Alert>
									<Loader2 className="animate-spin" aria-hidden="true" />
									<AlertTitle>Waiting for {machineName} to connect…</AlertTitle>
									{target?.status === "degraded" && (
										<AlertDescription>
											Couldn’t finish connecting. Check the setup on your machine and try again.
										</AlertDescription>
									)}
									{consumed && target?.status === "offline" && (
										<AlertDescription>
											Make sure the software is running on your machine.
										</AlertDescription>
									)}
								</Alert>
							)}
							{canDeploy && <DeploymentInstructions key={credential.token} credential={credential} />}
							{(credential || !target) && (
								<div className="flex justify-end gap-2 pt-4 border-t">
									<Button variant="secondary" onClick={backToMachines}>
										Back to machines
									</Button>
								</div>
							)}
						</>
					)}

					{connected && (
						<MachineConnectionSuccess
							agent={connected}
							onDone={backToMachines}
							onCreateSource={() => void navigate({ to: "/volumes/create" })}
						/>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
