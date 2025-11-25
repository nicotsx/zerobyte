import { useQuery } from "@tanstack/react-query";
import { Unplug } from "lucide-react";
import * as YML from "yaml";
import { getContainersUsingVolumeOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import { CodeBlock } from "~/client/components/ui/code-block";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/client/components/ui/table";
import type { Volume } from "~/client/lib/types";

type Props = {
	volume: Volume;
};

export const DockerTabContent = ({ volume }: Props) => {
	const yamlString = YML.stringify({
		services: {
			nginx: {
				image: "nginx:latest",
				volumes: [`zb-${volume.shortId}:/path/in/container`],
			},
		},
		volumes: {
			[`zb-${volume.shortId}`]: {
				external: true,
			},
		},
	});

	const dockerRunCommand = `docker run -v zb-${volume.shortId}:/path/in/container nginx:latest`;

	const {
		data: containersData,
		isLoading,
		error,
	} = useQuery({
		...getContainersUsingVolumeOptions({ path: { name: volume.name } }),
		refetchInterval: 10000,
		refetchOnWindowFocus: true,
	});

	const containers = containersData || [];

	const getStateClass = (state: string) => {
		switch (state) {
			case "running":
				return "bg-green-100 text-green-800";
			case "exited":
				return "bg-orange-100 text-orange-800";
			default:
				return "bg-gray-100 text-gray-800";
		}
	};

	return (
		<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
			<Card>
				<CardHeader>
					<CardTitle>Plug-and-play Docker integration</CardTitle>
					<CardDescription>
						This volume can be used in your Docker Compose files by referencing it as an external volume. The example
						demonstrates how to mount the volume to a service (nginx in this case). Make sure to adjust the path inside
						the container to fit your application's needs
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="relative space-y-6">
						<div className="space-y-4">
							<div className="flex flex-col gap-4">
								<CodeBlock code={yamlString} language="yaml" filename="docker-compose.yml" />
							</div>
							<div className="text-sm text-muted-foreground">
								Alternatively, you can use the following command to run a Docker container with the volume mounted
							</div>
							<div className="flex flex-col gap-4">
								<CodeBlock code={dockerRunCommand} filename="CLI one-liner" />
							</div>
						</div>
					</div>
				</CardContent>
			</Card>

			<div className="grid">
				<Card>
					<CardHeader>
						<CardTitle>Containers Using This Volume</CardTitle>
						<CardDescription>List of Docker containers mounting this volume.</CardDescription>
					</CardHeader>

					<CardContent className="space-y-4 text-sm h-full">
						{isLoading && <div>Loading containers...</div>}
						{error && <div className="text-destructive">Failed to load containers: {String(error)}</div>}
						{!isLoading && !error && containers.length === 0 && (
							<div className="flex flex-col items-center justify-center text-center h-full">
								<Unplug className="mb-4 h-5 w-5 text-muted-foreground" />
								<p className="text-muted-foreground">No Docker containers are currently using this volume.</p>
							</div>
						)}
						{!isLoading && !error && containers.length > 0 && (
							<div className="max-h-130 overflow-y-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Name</TableHead>
											<TableHead>ID</TableHead>
											<TableHead>State</TableHead>
											<TableHead>Image</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody className="text-sm">
										{containers.map((container) => (
											<TableRow key={container.id}>
												<TableCell>{container.name}</TableCell>
												<TableCell>{container.id.slice(0, 12)}</TableCell>
												<TableCell>
													<span
														className={`px-2 py-1 rounded-full text-xs font-medium ${getStateClass(container.state)}`}
													>
														{container.state}
													</span>
												</TableCell>
												<TableCell>{container.image}</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
};
