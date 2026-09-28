import { Box, Button, Stack, Text, Tooltip } from "@mantine/core";
import { Plus as IconPlus, Sparkles as IconSparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	GetKeywords200DataItem,
	GetKeywords200DataItemAliasesItem,
	GetKeywords200DataItemVersionsItem,
} from "@/api/generated/schemas";
import { SearchInput } from "@/components/search-input";
import { useNovelKeywords } from "@/hooks/use-novel-keywords";
import { useCanMutateKeywords } from "@/lib/auth";
import { toAiLanguage } from "@/lib/desktop-client/ai-language";
import {
	type KeywordSuggestion,
	relatedSuggestionDescription,
} from "@/lib/desktop-client/keyword-suggestion";
import { useAiConfigured } from "@/lib/desktop-client/use-ai-configured";
import { ColoringCards } from "./coloring-cards";
import { ColoringForm } from "./coloring-form";
import { useKeywordSuggestion } from "./use-keyword-suggestion";

type StackFrame =
	| {
			mode: "keyword-add";
			initialText?: string;
			suggestion?: KeywordSuggestion;
	  }
	| { mode: "keyword-edit"; keyword: GetKeywords200DataItem }
	| {
			mode: "alias-add";
			initialText?: string;
			suggestion?: KeywordSuggestion;
			parentKeyword: GetKeywords200DataItem;
	  }
	| {
			mode: "alias-edit";
			keyword: GetKeywords200DataItemAliasesItem;
			parentKeyword: GetKeywords200DataItem;
	  }
	| {
			mode: "version-add";
			initialText?: string;
			suggestion?: KeywordSuggestion;
			parentKeyword: GetKeywords200DataItem;
	  }
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
	const { t, i18n } = useTranslation();
	const canMutate = useCanMutateKeywords();
	const aiSuggestion = useKeywordSuggestion(canMutate, selectedNovelId);
	// Aliases and versions reuse the suggestion, noting which character they belong to.
	const relatedSuggestion = (
		kind: "alias" | "version",
		parent: GetKeywords200DataItem,
	): KeywordSuggestion | undefined =>
		aiSuggestion.status === "ready"
			? {
					...aiSuggestion.suggestion,
					description: relatedSuggestionDescription(
						aiSuggestion.suggestion,
						{ kind, name: search.trim(), parent: parent.name },
						toAiLanguage(i18n.language),
					),
				}
			: undefined;
	const [stack, setStack] = useState<StackFrame[]>([]);
	const [search, setSearch] = useState(
		() => new URLSearchParams(window.location.search).get("search") ?? "",
	);

	const params = new URLSearchParams(window.location.search);
	const aiConfigured = useAiConfigured();
	const hasAiContext = params.has("aiContext") && aiConfigured;
	const requested = params.get("create");
	const { keywords, isLoading } = useNovelKeywords(
		requested && requested !== "keyword" ? selectedNovelId : undefined,
	);
	const opened = useRef(false);
	useEffect(() => {
		if (
			opened.current ||
			!canMutate ||
			!selectedNovelId ||
			!requested ||
			aiSuggestion.status === "loading" ||
			(hasAiContext && aiSuggestion.status === "idle")
		)
			return;
		const suggestion =
			aiSuggestion.status === "ready" ? aiSuggestion.suggestion : undefined;
		if (requested === "keyword") {
			opened.current = true;
			setStack([
				{ mode: "keyword-add", initialText: search.trim(), suggestion },
			]);
		} else if (
			!isLoading &&
			(requested === "alias" || requested === "version")
		) {
			const parent = keywords.find(
				(item) =>
					item.id ===
					new URLSearchParams(window.location.search).get("parentId"),
			);
			if (!parent) return;
			opened.current = true;
			setStack([
				{
					mode: requested === "alias" ? "alias-add" : "version-add",
					parentKeyword: parent,
					initialText: search.trim(),
					suggestion: suggestion
						? {
								...suggestion,
								description: relatedSuggestionDescription(
									suggestion,
									{ kind: requested, name: search.trim(), parent: parent.name },
									toAiLanguage(i18n.language),
								),
							}
						: undefined,
				},
			]);
		}
	}, [
		canMutate,
		selectedNovelId,
		requested,
		aiSuggestion,
		isLoading,
		keywords,
		search,
		hasAiContext,
		i18n.language,
	]);
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
				<>
					<Tooltip label={t("_.add")} withArrow openDelay={350}>
						<Button
							type="button"
							variant="filled"
							loading={aiSuggestion.status === "loading"}
							leftSection={
								aiSuggestion.status === "ready" ? (
									<IconSparkles size={16} />
								) : (
									<IconPlus size={16} aria-hidden="true" />
								)
							}
							onClick={() =>
								pushFrame({
									mode: "keyword-add",
									initialText: search.trim(),
									suggestion:
										aiSuggestion.status === "ready"
											? aiSuggestion.suggestion
											: undefined,
								})
							}
							fullWidth
						>
							{t("_.add")}
						</Button>
					</Tooltip>
					{aiSuggestion.status === "loading" && (
						<Text size="xs" c="dimmed" ta="center" role="status">
							{t("coloring.aiSuggesting")}
						</Text>
					)}
					{aiSuggestion.status === "ready" && (
						<Text size="xs" c="dimmed" ta="center" role="status">
							{t("coloring.aiSuggestionReady")}
						</Text>
					)}
					{aiSuggestion.status === "error" && (
						<Text size="xs" c="red" ta="center" role="status">
							{t("coloring.aiFailed")}: {aiSuggestion.message}
						</Text>
					)}
				</>
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
					pushFrame({
						mode: "alias-add",
						parentKeyword: parent,
						initialText: search.trim(),
						suggestion: relatedSuggestion("alias", parent),
					})
				}
				onAddVersion={(parent) =>
					pushFrame({
						mode: "version-add",
						parentKeyword: parent,
						initialText: search.trim(),
						suggestion: relatedSuggestion("version", parent),
					})
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
