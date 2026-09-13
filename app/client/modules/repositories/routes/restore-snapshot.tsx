import { RestoreForm } from "~/client/components/restore-form";
import type { ComponentProps } from "react";

type Props = ComponentProps<typeof RestoreForm>;

export function RestoreSnapshotPage(props: Props) {
	return <RestoreForm key={`${props.repository.shortId}:${props.snapshot.short_id}`} {...props} />;
}
