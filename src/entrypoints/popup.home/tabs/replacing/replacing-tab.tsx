import { Box, Button, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GetReplacements200DataItem } from "@/api/schemas";
import { SearchInput } from "@/components/search-input";
import { useCanMutate } from "@/lib/auth";
import { ReplacingCards } from "./replacing-cards";
import type { ReplacingFormModesType } from "./replacing-form";
import { ReplacingForm } from "./replacing-form";

export function ReplacingTab({ selectedNovelId }: { selectedNovelId: string }) {
	const { t } = useTranslation();
	const canMutate = useCanMutate();
	const [replacingFormMode, setReplacingFormMode] =
		useState<ReplacingFormModesType>(undefined);
	const [replacement, setReplacement] = useState<
		GetReplacements200DataItem | undefined
	>(undefined);
	const [search, setSearch] = useState("");

	return (
		<Stack gap="xs" p="xs">
			{replacingFormMode ? (
				<ReplacingForm
					mode={replacingFormMode}
					selectedNovelId={selectedNovelId}
					hidden={!replacingFormMode}
					replacement={replacement}
					onClose={() => setReplacingFormMode(undefined)}
				/>
			) : (
				<>
					{canMutate ? (
						<Button
							type="submit"
							variant="light"
							color="green.7"
							onClick={() => {
								setReplacement(undefined);
								setReplacingFormMode("add");
							}}
							hidden={!!replacingFormMode}
							fullWidth
						>
							{t("_.add")}
						</Button>
					) : (
						<Text size="xs" c="dimmed" ta="center">
							{t("auth.guestReadOnly")}
						</Text>
					)}
					<Box
						pos="sticky"
						top="var(--popup-tabs-sticky-height, 46px)"
						py="xs"
						style={{ zIndex: 1 }}
						bg="var(--mantine-color-body)"
					>
						<SearchInput
							value={search}
							onChange={setSearch}
							w="100%"
							variant="default"
						/>
					</Box>
					<ReplacingCards
						selectedNovelId={selectedNovelId}
						search={search}
						setReplacement={setReplacement}
						setMode={setReplacingFormMode}
						readOnly={!canMutate}
					/>
				</>
			)}
		</Stack>
	);
}
