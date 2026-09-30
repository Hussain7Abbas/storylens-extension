import {
	Center,
	Group,
	Loader,
	Stack,
	type StackProps,
	Text,
	Tooltip,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { GetReplacements200DataItem } from "@/api/generated/schemas";
import { SyncBadge } from "@/components/sync-badge";
import { canEditReplacement } from "@/lib/auth/permissions";
import { useCurrentUser } from "@/lib/auth/use-permissions";
import {
	useOfflineReplacements,
	usePendingEntityIds,
} from "@/lib/offline/hooks";
import { fuzzyMatches } from "@/utils/fuzzy-search";
import { ListItemCard } from "../list-item-card";
import type { ReplacingFormModesType } from "./replacing-form";

interface ReplacingFormProps extends StackProps {
	selectedNovelId: string;
	search: string;
	setReplacement: (replacement: GetReplacements200DataItem) => void;
	setMode: (mode: ReplacingFormModesType) => void;
	readOnly?: boolean;
}

export function ReplacingCards({
	selectedNovelId,
	search,
	setReplacement,
	setMode,
	readOnly = false,
	...props
}: ReplacingFormProps) {
	const { t } = useTranslation();
	const user = useCurrentUser();
	const pendingEntityIds = usePendingEntityIds();
	// One source of truth: the novel's view, online and offline (W2).
	const offline = useOfflineReplacements(selectedNovelId, "");
	const items = (offline.items ?? []).filter((item) =>
		fuzzyMatches(search, [item.from, item.to]),
	);
	const isLoading = offline.isLoading;
	const notAvailableOffline = offline.notAvailableOffline;

	if (isLoading) {
		return (
			<Center>
				<Loader />
			</Center>
		);
	}

	if (items.length === 0 && notAvailableOffline) {
		return (
			<Text ta="center" c="dimmed" size="sm">
				{t("offline.notAvailableOffline")}
			</Text>
		);
	}

	if (items.length === 0) {
		return (
			<Text ta="center" c="dimmed">
				{t("replacing.noReplacements")}
			</Text>
		);
	}

	return (
		<Stack gap="xs" {...props}>
			{items.map((replacement) => {
				const isPending = pendingEntityIds.has(replacement.id);
				const locked = !readOnly && !canEditReplacement(user, replacement);

				return (
					<Tooltip
						key={replacement.id}
						label={t("permissions.creatorOrModerator")}
						disabled={!locked}
						withArrow
						openDelay={300}
					>
						<div>
							<ListItemCard
								onClick={
									readOnly || locked
										? undefined
										: () => {
												setReplacement(replacement);
												setMode("edit");
											}
								}
							>
								<Group wrap="nowrap" align="flex-start" gap="xs" w="100%">
									<Text fw={500} style={{ flex: 1 }}>
										{replacement.from}
									</Text>
									<SyncBadge
										state={
											offline.states.get(replacement.id) ??
											(isPending ? "pending" : undefined)
										}
									/>
									<Text size="sm" c="dimmed" style={{ flex: 1 }}>
										{replacement.to}
									</Text>
								</Group>
							</ListItemCard>
						</div>
					</Tooltip>
				);
			})}
		</Stack>
	);
}
