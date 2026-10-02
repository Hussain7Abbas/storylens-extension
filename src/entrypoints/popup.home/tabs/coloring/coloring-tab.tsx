import { Box, Button, Stack, Text, Tooltip } from "@mantine/core";
import { useAtom } from "jotai";
import { Plus as IconPlus, Sparkles as IconSparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	GetKeywords200DataItem,
	GetKeywords200DataItemAliasesItem,
	GetKeywords200DataItemVersionsItem,
} from "@/api/generated/schemas";
import { AiPrice } from "@/components/lens/ai-price";
import { GetLensesLink } from "@/components/lens/get-lenses-link";
import { SearchInput } from "@/components/search-input";
import { useCanMutateKeywords } from "@/lib/auth";
import {
	canEditAlias,
	canEditKeyword,
	canEditVersion,
} from "@/lib/auth/permissions";
import { useCurrentUser } from "@/lib/auth/use-permissions";
import { toAiLanguage } from "@/lib/desktop-client/ai-language";
import {
	type KeywordSuggestion,
	relatedSuggestionDescription,
} from "@/lib/desktop-client/keyword-suggestion";
import { useNovelKeywords } from "@/lib/offline/hooks";
import { useLanguage } from "@/store/locale";
import { showExistingAtom } from "@/store/show-existing";
import { nameIn } from "@/utils/translation";
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

/**
 * Drops a handled form request from the popup's URL. The launcher keeps the
 * popup loaded, so without this the tab would reopen the same form each time
 * it mounts again (for example after a visit to Settings).
 */
function consumeRequest(...names: string[]): void {
	const url = new URL(window.location.href);
	for (const name of names) url.searchParams.delete(name);
	window.history.replaceState(window.history.state, "", url);
}

export function ColoringTab({
	selectedNovelId,
	currentChapter,
}: {
	selectedNovelId: string | undefined;
	currentChapter: number | undefined;
}) {
	const { t, i18n } = useTranslation();
	const language = useLanguage();
	const canMutate = useCanMutateKeywords();
	const { state: aiSuggestion, clear: clearAiSuggestion } =
		useKeywordSuggestion(canMutate, selectedNovelId);
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
						{ kind, name: search.trim(), parent: nameIn(parent, language) },
						toAiLanguage(i18n.language),
					),
				}
			: undefined;
	const [stack, setStack] = useState<StackFrame[]>([]);
	const [showExisting, setShowExisting] = useAtom(showExistingAtom);
	const [search, setSearch] = useState(
		() =>
			showExisting.search ??
			new URLSearchParams(window.location.search).get("search") ??
			"",
	);
	useEffect(() => {
		if (showExisting.search !== undefined)
			setShowExisting((current) => ({ ...current, search: undefined }));
	}, [showExisting.search, setShowExisting]);

	const params = new URLSearchParams(window.location.search);
	const hasAiContext = params.has("aiContext");
	const requested = params.get("create");
	// A page tooltip's Edit button names the entry whose form to open.
	const requestedEdit = params.get("edit");
	const user = useCurrentUser();
	const { keywords, isLoading } = useNovelKeywords(
		(requested && requested !== "keyword") || requestedEdit
			? selectedNovelId
			: undefined,
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
			consumeRequest("create", "aiContext");
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
			consumeRequest("create", "parentId", "aiContext");
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
									{
										kind: requested,
										name: search.trim(),
										parent: nameIn(parent, language),
									},
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
		language,
	]);
	useEffect(() => {
		if (opened.current || !selectedNovelId || !requestedEdit || isLoading)
			return;
		const search = new URLSearchParams(window.location.search);
		const id = search.get("id");
		const parent = keywords.find((item) => item.id === search.get("parentId"));
		if (!parent) return;
		// Same per-row rules as the cards: a row the reader may not change stays closed.
		let frame: StackFrame | undefined;
		if (requestedEdit === "keyword") {
			if (canEditKeyword(user, parent))
				frame = { mode: "keyword-edit", keyword: parent };
		} else if (requestedEdit === "alias") {
			const alias = parent.aliases.find((item) => item.id === id);
			if (alias && canEditAlias(user, alias, parent))
				frame = { mode: "alias-edit", keyword: alias, parentKeyword: parent };
		} else if (requestedEdit === "version") {
			const version = parent.versions.find((item) => item.id === id);
			if (version && canEditVersion(user, version, parent))
				frame = {
					mode: "version-edit",
					keyword: version,
					parentKeyword: parent,
				};
		}
		if (!frame) return;
		opened.current = true;
		consumeRequest("edit", "id", "parentId");
		setStack([frame]);
	}, [selectedNovelId, requestedEdit, isLoading, keywords, user]);
	const currentFrame = stack[stack.length - 1];

	function pushFrame(frame: StackFrame) {
		setStack((prev) => [...prev, frame]);
	}

	function popFrame() {
		// The tab stays mounted after its last form closes; its AI result no longer does.
		if (stack.length === 1) clearAiSuggestion();
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
							{t("coloring.aiSuggesting")}{" "}
							<AiPrice feature="keyword_suggestion" />
						</Text>
					)}
					{aiSuggestion.status === "ready" && (
						<Text size="xs" c="dimmed" ta="center" role="status">
							{t("coloring.aiSuggestionReady")}
						</Text>
					)}
					{aiSuggestion.status === "error" && (
						<Text size="xs" c="red" ta="center" role="status">
							{t("coloring.aiFailed")}: {aiSuggestion.message} <GetLensesLink />
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
