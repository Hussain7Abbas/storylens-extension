import { Box, Button, Stack, Tooltip } from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SearchInput } from "@/components/search-input";
import type { KeywordNature } from "@/types/models";
import { NatureCards } from "./nature-cards";
import { NatureForm, type NatureFormModesType } from "./nature-form";

export function NatureTab() {
	const { t } = useTranslation();
	const [formMode, setFormMode] = useState<NatureFormModesType>(undefined);
	const [nature, setNature] = useState<KeywordNature | undefined>();
	const [search, setSearch] = useState("");

	if (formMode) {
		return (
			<NatureForm
				mode={formMode}
				nature={nature}
				onClose={() => {
					setFormMode(undefined);
					setNature(undefined);
				}}
			/>
		);
	}

	return (
		<Stack gap="xs" pt="xs">
			<Tooltip label={t("settings.addNature")} withArrow openDelay={350}>
				<Button
					variant="light"
					onClick={() => {
						setNature(undefined);
						setFormMode("add");
					}}
				>
					{t("settings.addNature")}
				</Button>
			</Tooltip>

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

			<NatureCards
				search={search}
				setNature={setNature}
				setMode={setFormMode}
			/>
		</Stack>
	);
}
