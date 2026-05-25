import { Box, Button, Stack } from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SearchInput } from "@/components/search-input";
import type { KeywordCategory } from "@/types/models";
import { CategoryCards } from "./category-cards";
import { CategoryForm, type CategoryFormModesType } from "./category-form";

export function CategoryTab() {
	const { t } = useTranslation();
	const [formMode, setFormMode] = useState<CategoryFormModesType>(undefined);
	const [category, setCategory] = useState<KeywordCategory | undefined>();
	const [search, setSearch] = useState("");

	if (formMode) {
		return (
			<CategoryForm
				mode={formMode}
				category={category}
				onClose={() => {
					setFormMode(undefined);
					setCategory(undefined);
				}}
			/>
		);
	}

	return (
		<Stack gap="xs" pt="xs">
			<Button
				variant="light"
				color="green.7"
				onClick={() => {
					setCategory(undefined);
					setFormMode("add");
				}}
			>
				{t("settings.addCategory")}
			</Button>

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

			<CategoryCards
				search={search}
				setCategory={setCategory}
				setMode={setFormMode}
			/>
		</Stack>
	);
}
