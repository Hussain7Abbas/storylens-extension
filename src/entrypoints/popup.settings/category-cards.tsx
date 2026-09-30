import {
	Box,
	Center,
	Group,
	Loader,
	Stack,
	type StackProps,
	Text,
} from "@mantine/core";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { SyncBadge } from "@/components/sync-badge";
import { ListItemCard } from "@/entrypoints/popup.home/tabs/list-item-card";
import {
	useOfflineKeywordCategories,
	usePendingEntityIds,
} from "@/lib/offline/hooks";
import { localeAtom } from "@/store/locale";
import type { KeywordCategory } from "@/types/models";
import type { CategoryFormModesType } from "./category-form";

interface CategoryCardsProps extends StackProps {
	search: string;
	setCategory: (category: KeywordCategory) => void;
	setMode: (mode: CategoryFormModesType) => void;
}

export function CategoryCards({
	search,
	setCategory,
	setMode,
	...props
}: CategoryCardsProps) {
	const { t } = useTranslation();
	const locale = useAtomValue(localeAtom);
	const pendingEntityIds = usePendingEntityIds();
	const {
		data: items,
		isLoading,
		states,
	} = useOfflineKeywordCategories(search);

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
				{t("category.noRecords")}
			</Text>
		);
	}

	return (
		<Stack gap="xs" {...props}>
			{items.map((category) => {
				const isPending = pendingEntityIds.has(category.id);
				const displayName =
					locale === "ar"
						? category.nameAr || category.nameEn || ""
						: category.nameEn || category.nameAr || "";

				return (
					<ListItemCard
						key={category.id}
						onClick={() => {
							setCategory(category);
							setMode("edit");
						}}
					>
						<Group wrap="nowrap" align="center" gap="xs">
							<Box
								w={12}
								h={12}
								style={{
									backgroundColor: category.color,
									borderRadius: 4,
									flexShrink: 0,
								}}
							/>
							<Text fw={500} style={{ flex: 1 }}>
								{displayName}
							</Text>
							<Group gap="xs" wrap="nowrap">
								<SyncBadge
									state={
										states.get(category.id) ??
										(isPending ? "pending" : undefined)
									}
								/>
								<Text size="xs" c="dimmed">
									{category.color}
								</Text>
							</Group>
						</Group>
					</ListItemCard>
				);
			})}
		</Stack>
	);
}
