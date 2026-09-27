import { Button, Skeleton, Stack, Text, Tooltip } from "@mantine/core";
import { Globe as IconPlanet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGetWebsiteSelectors } from "@/api/generated/endpoints/website-selectors.js";

interface NodeSelectorTableProps {
	onEdit: (website: string) => void;
}

export function NodeSelectorTable({ onEdit }: NodeSelectorTableProps) {
	const { t } = useTranslation();

	const { data: selectorsData, isLoading } = useGetWebsiteSelectors();

	const tableData = selectorsData?.data?.data ?? [];

	if (isLoading) {
		return <Skeleton height={100} />;
	}

	return (
		<Stack p="sm" gap="xs">
			{tableData.length === 0 && <Text>{t("nodeSelector.noData")}</Text>}
			{tableData.map((record) => (
				<Tooltip
					key={record.website}
					label={record.website}
					withArrow
					openDelay={350}
				>
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
				</Tooltip>
			))}
		</Stack>
	);
}
