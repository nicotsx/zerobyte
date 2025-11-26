import { Card } from "~/client/components/ui/card";
import type { Repository } from "~/client/lib/types";

type Props = {
	repository: Repository;
};

export const RepositoryInfoTabContent = ({ repository }: Props) => {
	return (
		<Card className="p-6">
			<div className="space-y-6">
				<div>
					<h3 className="text-lg font-semibold mb-4">Repository Information</h3>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							<div className="text-sm font-medium text-muted-foreground">Name</div>
							<p className="mt-1 text-sm">{repository.name}</p>
						</div>
						<div>
							<div className="text-sm font-medium text-muted-foreground">Backend</div>
							<p className="mt-1 text-sm">{repository.type}</p>
						</div>
						<div>
							<div className="text-sm font-medium text-muted-foreground">Compression Mode</div>
							<p className="mt-1 text-sm">{repository.compressionMode || "off"}</p>
						</div>
						<div>
							<div className="text-sm font-medium text-muted-foreground">Status</div>
							<p className="mt-1 text-sm">{repository.status || "unknown"}</p>
						</div>
						<div>
							<div className="text-sm font-medium text-muted-foreground">Created At</div>
							<p className="mt-1 text-sm">{new Date(repository.createdAt * 1000).toLocaleString()}</p>
						</div>
							<div>
								<div className="text-sm font-medium text-muted-foreground">Last Checked</div>
								<p className="mt-1 text-sm">
									{repository.lastChecked ? new Date(repository.lastChecked * 1000).toLocaleString() : "Never"}
								</p>
							</div>
					</div>
				</div>
				{repository.lastError && (
					<div>
						<div className="flex items-center justify-between mb-4">
							<h3 className="text-lg font-semibold text-red-500">Last Error</h3>
						</div>

						<div className="bg-red-500/10 border border-red-500/20 rounded-md p-4">
							<p className="text-sm text-red-500">{repository.lastError}</p>
						</div>
					</div>
				)}
				<div>
					<h3 className="text-lg font-semibold mb-4">Configuration</h3>
					<div className="bg-muted/50 rounded-md p-4">
						<pre className="text-sm overflow-auto">{JSON.stringify(repository.config, null, 2)}</pre>
					</div>
				</div>
			</div>
		</Card>
	);
};
