import { useSuspenseQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/client/components/ui/tabs";
import { VolumeInfoTabContent } from "../tabs/info";
import { FilesTabContent } from "../tabs/files";
import { getVolumeOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { useNavigate } from "@tanstack/react-router";

export function VolumeDetails({ volumeId }: { volumeId: string }) {
	const navigate = useNavigate();
	const searchParams = useSearch({ from: "/(dashboard)/volumes/$volumeId" });

	const activeTab = searchParams.tab || "info";

	const { data } = useSuspenseQuery({
		...getVolumeOptions({ path: { id: volumeId } }),
	});

	const { volume, statfs } = data;

	return (
		<>
			<Tabs value={activeTab} onValueChange={(value) => navigate({ to: ".", search: () => ({ tab: value }) })}>
				<TabsList className="mb-2">
					<TabsTrigger value="info">Configuration</TabsTrigger>
					<TabsTrigger value="files">Files</TabsTrigger>
				</TabsList>
				<TabsContent value="info">
					<VolumeInfoTabContent volume={volume} statfs={statfs} />
				</TabsContent>
				<TabsContent value="files">
					<FilesTabContent volume={volume} />
				</TabsContent>
			</Tabs>
		</>
	);
}
