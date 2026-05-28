import {
	Badge,
	Box,
	Center,
	Group,
	Loader,
	Stack,
	type StackProps,
	Text,
} from "@mantine/core";
import { IconCloudUpload } from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { ListItemCard } from "@/entrypoints/popup.home/tabs/list-item-card";
import {
	useOfflineKeywordNatures,
	usePendingEntityIds,
} from "@/lib/offline/hooks";
import { localeAtom } from "@/store/locale";
import type { KeywordNature } from "@/types/models";
import type { NatureFormModesType } from "./nature-form";

interface NatureCardsProps extends StackProps {
	search: string;
	setNature: (nature: KeywordNature) => void;
	setMode: (mode: NatureFormModesType) => void;
}

export function NatureCards({
	search,
	setNature,
	setMode,
	...props
}: NatureCardsProps) {
	const { t } = useTranslation();
	const locale = useAtomValue(localeAtom);
	const pendingEntityIds = usePendingEntityIds();
	const { data: items, isLoading } = useOfflineKeywordNatures(search);

	if (isLoading) {
		return (
			<Center>
				<Loader />
			</Center>
		);
	}

	if (items.length === 0) {
		return (
			<Text ta="center" c="dimmed">
				{t("dataTable.noRecords")}
			</Text>
		);
	}

	return (
		<Stack gap="xs" {...props}>
			{items.map((nature) => {
				const isPending = pendingEntityIds.has(nature.id);
				const displayName =
					locale === "ar"
						? nature.nameAr || nature.nameEn || ""
						: nature.nameEn || nature.nameAr || "";

				return (
					<ListItemCard
						key={nature.id}
						onClick={() => {
							setNature(nature);
							setMode("edit");
						}}
					>
						<Group wrap="nowrap" align="center" gap="xs">
							<Box
								w={12}
								h={12}
								style={{
									backgroundColor: nature.color,
									borderRadius: 4,
									flexShrink: 0,
								}}
							/>
							<Text fw={500} style={{ flex: 1 }}>
								{displayName}
							</Text>
							<Group gap="xs" wrap="nowrap">
								{isPending && (
									<Badge
										size="xs"
										color="orange"
										variant="light"
										leftSection={<IconCloudUpload size={12} />}
									>
										{t("offline.pendingSync")}
									</Badge>
								)}
								<Text size="xs" c="dimmed">
									{nature.color}
								</Text>
							</Group>
						</Group>
					</ListItemCard>
				);
			})}
		</Stack>
	);
}
