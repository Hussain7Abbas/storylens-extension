import { Box, Button, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GetKeywords200DataItem } from "@/api/schemas";
import { SearchInput } from "@/components/search-input";
import { useCanMutateKeywords } from "@/lib/auth";
import { ColoringCards } from "./coloring-cards";
import type { ColoringFormModesType } from "./coloring-form";
import { ColoringForm } from "./coloring-form";

export function ColoringTab({ selectedNovelId }: { selectedNovelId: string }) {
	const { t } = useTranslation();
	const canMutate = useCanMutateKeywords();
	const [coloringFormMode, setColoringFormMode] =
		useState<ColoringFormModesType>(undefined);
	const [keyword, setKeyword] = useState<GetKeywords200DataItem | undefined>(
		undefined,
	);
	const [search, setSearch] = useState("");

	return (
		<Stack gap="xs" p="xs">
			{coloringFormMode ? (
				<ColoringForm
					mode={coloringFormMode}
					selectedNovelId={selectedNovelId}
					hidden={!coloringFormMode}
					keyword={keyword}
					onClose={() => setColoringFormMode(undefined)}
				/>
			) : (
				<>
					{canMutate ? (
						<Button
							type="submit"
							variant="light"
							color="green.7"
							onClick={() => {
								setKeyword(undefined);
								setColoringFormMode("add");
							}}
							hidden={!!coloringFormMode}
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
					<ColoringCards
						selectedNovelId={selectedNovelId}
						search={search}
						setKeyword={setKeyword}
						setMode={setColoringFormMode}
						readOnly={!canMutate}
					/>
				</>
			)}
		</Stack>
	);
}
