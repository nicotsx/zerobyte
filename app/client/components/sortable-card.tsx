import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { PropsWithChildren } from "react";

interface SortableBackupCardProps {
	isDragging?: boolean;
	uniqueId: number;
}

export function SortableCard({ isDragging, uniqueId, children }: PropsWithChildren<SortableBackupCardProps>) {
	const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
		id: uniqueId,
	});

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	};

	return (
		<div ref={setNodeRef} style={style} className="relative group">
			<div
				{...attributes}
				{...listeners}
				className="absolute left-1/2 -translate-x-1/2 top-1 z-10 cursor-grab active:cursor-grabbing opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted/50 bg-background/80 backdrop-blur-sm"
			>
				<GripVertical className="h-4 w-4 text-muted-foreground rotate-90" />
			</div>
			{children}
		</div>
	);
}
