import { Badge, UnstyledButton } from "@mantine/core";
import {
	CloudAlert as IconCloudAlert,
	CloudUpload as IconCloudUpload,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRoutes } from "@/hooks/useRoutes";
import type { EntitySyncState } from "@/lib/offline/types";

/**
 * A row's sync state from its view: "Pending" while its change waits to be
 * sent, or "Needs attention" (a link to the Sync status page) when it conflicts
 * or was refused.
 */
export function SyncBadge({ state }: { state: EntitySyncState | undefined }) {
	const { t } = useTranslation();
	const { push } = useRoutes();
	if (!state) return null;
	if (state === "conflict" || state === "rejected") {
		return (
			<UnstyledButton
				aria-label={t("sync.openStatus")}
				onClick={(event) => {
					event.stopPropagation();
					push("sync");
				}}
			>
				<Badge
					size="xs"
					color="red"
					variant="light"
					leftSection={<IconCloudAlert size={12} />}
					style={{ cursor: "pointer" }}
				>
					{t("sync.needsAttentionShort")}
				</Badge>
			</UnstyledButton>
		);
	}
	return (
		<Badge
			size="xs"
			color="orange"
			variant="light"
			leftSection={<IconCloudUpload size={12} />}
		>
			{t("offline.pendingSync")}
		</Badge>
	);
}
