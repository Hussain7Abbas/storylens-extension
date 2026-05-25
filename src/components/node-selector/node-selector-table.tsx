import { Button, Skeleton, Stack, Text } from "@mantine/core";
import { IconPlanet } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useGetConfigsByKey } from "@/api/endpoints/configs.js";
import type { websiteSelectors } from "@/types/configs";
import { WEBSITES_SELECTORS_KEY } from "./constants";

interface NodeSelectorTableProps {
	onEdit: (website: string) => void;
}

export function NodeSelectorTable({ onEdit }: NodeSelectorTableProps) {
	const { t } = useTranslation();

	const { data: configData, isLoading } = useGetConfigsByKey<{
		data: {
			key: string;
			value: string;
		};
	}>(WEBSITES_SELECTORS_KEY);

	// Parse selectors from config
	const selectors: websiteSelectors = configData?.data?.value
		? JSON.parse(configData.data.value)
		: {};

	const tableData = Object.entries(selectors).map(([website]) => ({
		website,
	}));

	if (isLoading) {
		return <Skeleton height={100} />;
	}

	return (
		<Stack p="sm" gap="xs">
			{tableData.length === 0 && <Text>{t("nodeSelector.noData")}</Text>}
			{tableData.map((record) => (
				<Button
					key={record.website}
					size="md"
					variant="subtle"
					onClick={() => onEdit(record.website)}
					leftSection={<IconPlanet />}
					fullWidth
					style={{
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
					}}
					styles={{
						inner: {
							justifyContent: "start",
						},
					}}
				>
					{record.website}
				</Button>
			))}
		</Stack>
	);
}
