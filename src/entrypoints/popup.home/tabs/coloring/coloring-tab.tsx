import { Box, Button, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GetKeywords200DataItem } from "@/api/generated/schemas";
import { SearchInput } from "@/components/search-input";
import { useCanMutateKeywords } from "@/lib/auth";
import { ColoringCards } from "./coloring-cards";
import { ColoringForm } from "./coloring-form";

type StackFrame = {
	mode: "add" | "edit";
	keyword?: GetKeywords200DataItem;
	parentKeyword?: GetKeywords200DataItem;
};

export function ColoringTab({ selectedNovelId }: { selectedNovelId: string }) {
	const { t } = useTranslation();
	const canMutate = useCanMutateKeywords();
	const [stack, setStack] = useState<StackFrame[]>([]);
	const [search, setSearch] = useState("");

	const currentFrame = stack[stack.length - 1];

	function pushFrame(frame: StackFrame) {
		setStack((prev) => [...prev, frame]);
	}

	function popFrame() {
		setStack((prev) => prev.slice(0, -1));
	}

	if (currentFrame) {
		return (
			<ColoringForm
				mode={currentFrame.mode}
				selectedNovelId={selectedNovelId}
				keyword={currentFrame.keyword}
				parentKeyword={currentFrame.parentKeyword}
				onClose={popFrame}
			/>
		);
	}

	return (
		<Stack gap="xs" p="xs">
			{canMutate ? (
				<Button
					type="submit"
					variant="light"
					color="green.7"
					onClick={() => pushFrame({ mode: "add" })}
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
				setKeyword={(keyword, parent) =>
					pushFrame({ mode: "edit", keyword, parentKeyword: parent })
				}
				onAddAlias={(parent) =>
					pushFrame({ mode: "add", parentKeyword: parent })
				}
				readOnly={!canMutate}
			/>
		</Stack>
	);
}
