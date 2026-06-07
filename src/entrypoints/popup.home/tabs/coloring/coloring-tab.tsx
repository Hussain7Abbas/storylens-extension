import { Box, Button, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	GetKeywords200DataItem,
	GetKeywords200DataItemAliasesItem,
	GetKeywords200DataItemVersionsItem,
} from "@/api/generated/schemas";
import { SearchInput } from "@/components/search-input";
import { useCanMutateKeywords } from "@/lib/auth";
import { ColoringCards } from "./coloring-cards";
import { ColoringForm } from "./coloring-form";

type StackFrame =
	| { mode: "keyword-add" }
	| { mode: "keyword-edit"; keyword: GetKeywords200DataItem }
	| { mode: "alias-add"; parentKeyword: GetKeywords200DataItem }
	| {
			mode: "alias-edit";
			keyword: GetKeywords200DataItemAliasesItem;
			parentKeyword: GetKeywords200DataItem;
	  }
	| { mode: "version-add"; parentKeyword: GetKeywords200DataItem }
	| {
			mode: "version-edit";
			keyword: GetKeywords200DataItemVersionsItem;
			parentKeyword: GetKeywords200DataItem;
	  };

export function ColoringTab({
	selectedNovelId,
	currentChapter,
}: {
	selectedNovelId: string | undefined;
	currentChapter: number | undefined;
}) {
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

	if (currentFrame && selectedNovelId) {
		return (
			<ColoringForm
				frame={currentFrame}
				selectedNovelId={selectedNovelId}
				currentChapter={currentChapter}
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
					onClick={() => pushFrame({ mode: "keyword-add" })}
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
				currentChapter={currentChapter}
				search={search}
				onEditKeyword={(keyword) =>
					pushFrame({ mode: "keyword-edit", keyword })
				}
				onEditAlias={(alias, parent) =>
					pushFrame({
						mode: "alias-edit",
						keyword: alias,
						parentKeyword: parent,
					})
				}
				onAddAlias={(parent) =>
					pushFrame({ mode: "alias-add", parentKeyword: parent })
				}
				onAddVersion={(parent) =>
					pushFrame({ mode: "version-add", parentKeyword: parent })
				}
				onEditVersion={(version, parent) =>
					pushFrame({
						mode: "version-edit",
						keyword: version,
						parentKeyword: parent,
					})
				}
				readOnly={!canMutate}
			/>
		</Stack>
	);
}
