import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { availabilityKey } from "@/lib/ai-source/availability";
import { useAiSnapshot } from "@/lib/ai-source/hooks";
import { aiState } from "@/lib/ai-source/storage";
import { trackEvent } from "@/lib/analytics/client";
import { withImageContinuity } from "@/lib/chapter-context/image";
import { aiErrorMessage } from "@/lib/cloud-ai/top-up";
import { toAiLanguage } from "@/lib/desktop-client/ai-language";
import { buildCharacterImagePrompt } from "@/lib/desktop-client/character-image";
import {
	type GeneratedCharacterImage,
	generateCharacterImage,
} from "@/lib/desktop-client/character-image-job";
import {
	boundTranslationCandidates,
	buildKeywordSuggestionPrompt,
	decodeKeywordContext,
	KEYWORD_CONTEXT_PARAM,
	type KeywordSuggestion,
	parseKeywordSuggestion,
	type TranslationCandidates,
} from "@/lib/desktop-client/keyword-suggestion";
import { executeLocalizedPrompt } from "@/lib/desktop-client/localized-prompt";
import { ensureNovelContext } from "@/lib/desktop-client/novel-context";
import { aiPrompts } from "@/lib/desktop-client/settings";
import { useAiTask } from "@/lib/launcher-frame/use-ai-task";
import { useLauncherWork } from "@/lib/launcher-frame/use-launcher-work";
import {
	useOfflineKeywordCategories,
	useOfflineKeywordNatures,
	useTranslationAliases,
	useTranslationKeywords,
} from "@/lib/offline/hooks";
import { useLanguage } from "@/store/locale";
import { keywordDescriptionIn } from "@/utils/translation";

export type KeywordSuggestionState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "ready"; suggestion: KeywordSuggestion }
	| { status: "error"; message: string };

export type SelectionImageState = (
	| { status: "idle" }
	| { status: "stopped" }
	| { status: "loading" }
	| ({ status: "ready" } & GeneratedCharacterImage)
	| { status: "error"; message: string }
) & { prompt?: string };

/**
 * Requests a description, category, and nature for the text picked with the
 * selection panel with AI enabled. The page context arrives in a hidden query parameter;
 * the reader's keyword prompt and the novel's global context are added to it.
 */
export function useKeywordSuggestion(
	enabled: boolean,
	novelId: string | undefined,
): {
	state: KeywordSuggestionState;
	image: SelectionImageState;
	stopImage: () => void;
	clear: () => void;
} {
	const { t, i18n } = useTranslation();
	// Resource loading can replace t without changing the requested AI language.
	// Keep that UI refresh from cancelling/replaying an in-flight AI action.
	const translate = useRef(t);
	translate.current = t;
	const request = useMemo(() => {
		const params = new URLSearchParams(window.location.search);
		const name = params.get("search")?.trim();
		const context = decodeKeywordContext(params.get(KEYWORD_CONTEXT_PARAM));
		// The chooser says which form it is opening and, for a child, its keyword.
		const kind = params.get("create");
		const parentId = params.get("parentId") ?? undefined;
		return name && context
			? {
					name,
					context,
					kind,
					parentId,
					generateImage: params.get("generate") === "image",
				}
			: undefined;
	}, []);
	const { data: categories } = useOfflineKeywordCategories();
	const { data: natures } = useOfflineKeywordNatures();
	// Entries the form's other-language tab could link, so the answer can propose
	// one: named in that language and not in the reader's (same rule as the form).
	const uiLanguage = useLanguage();
	const candidates = useMemo(
		() => ({
			language: uiLanguage === "ar" ? ("en" as const) : ("ar" as const),
			without: uiLanguage,
		}),
		[uiLanguage],
	);
	const { keywords: keywordTranslations, isLoading: keywordsLoading } =
		useTranslationKeywords(
			request?.kind === "keyword" ? novelId : undefined,
			candidates,
		);
	const { aliases: aliasTranslations, isLoading: aliasesLoading } =
		useTranslationAliases(
			request?.kind === "alias" ? novelId : undefined,
			request?.parentId,
			candidates,
		);
	const translations: TranslationCandidates | undefined = useMemo(() => {
		if (request?.kind === "keyword" && keywordTranslations.length) {
			return {
				kind: "keyword",
				options: boundTranslationCandidates(
					keywordTranslations.map((keyword) => ({
						id: keyword.id,
						nameAr: keyword.nameAr,
						nameEn: keyword.nameEn,
						description: keywordDescriptionIn(
							[...keyword.versions].sort(
								(left, right) =>
									Number(left.startingChapter) - Number(right.startingChapter),
							)[0],
							candidates.language,
						),
					})),
				),
			};
		}
		if (request?.kind === "alias" && aliasTranslations.length) {
			return {
				kind: "alias",
				options: boundTranslationCandidates(
					aliasTranslations.map((alias) => ({
						id: alias.id,
						nameAr: alias.nameAr,
						nameEn: alias.nameEn,
						description: keywordDescriptionIn(alias, candidates.language),
					})),
				),
			};
		}
		return undefined;
	}, [request, keywordTranslations, aliasTranslations, candidates.language]);
	const lookups = useRef({ categories, natures, translations });
	lookups.current = { categories, natures, translations };
	const lookupsReady =
		!!categories && !!natures && !keywordsLoading && !aliasesLoading;
	const [state, setState] = useState<KeywordSuggestionState>({
		status: "idle",
	});
	const [image, setImage] = useState<SelectionImageState>({ status: "idle" });
	const finished = useRef(false);
	const requestController = useRef<AbortController | null>(null);
	const imageController = useRef<AbortController | null>(null);
	const imageStopped = useRef(false);
	const language = toAiLanguage(i18n.language);
	const { loaded } = useAiSnapshot();

	useEffect(() => {
		if (!request || !loaded || !enabled || !lookupsReady || finished.current)
			return;
		const t = translate.current;
		const controller = new AbortController();
		requestController.current = controller;
		const drawing = new AbortController();
		imageController.current = drawing;
		if (imageStopped.current) drawing.abort();
		setState({ status: "loading" });
		if (request.generateImage && !imageStopped.current)
			setImage({ status: "loading" });
		void (async () => {
			const [ai, imageAi] = await Promise.all([
				aiState("keyword_suggestion"),
				aiState("character_image"),
			]);
			const settings = ai.desktop;
			if (controller.signal.aborted) return;
			const imageAvailability = imageAi.availability;
			const options = {
				categories: lookups.current.categories ?? [],
				natures: lookups.current.natures ?? [],
				translations: lookups.current.translations,
			};
			const [prompts, novelContext] = await Promise.all([
				aiPrompts(),
				novelId
					? ensureNovelContext({
							novelId,
							language,
							settings,
							source: ai.source,
							parentFeature: "keyword_suggestion",
							additionalParentFeatures:
								request.generateImage &&
								!drawing.signal.aborted &&
								imageAvailability.ok &&
								imageAi.source === "cloud"
									? ["character_image"]
									: [],
							signal: controller.signal,
						})
					: "",
			]);
			if (controller.signal.aborted) return;
			const suggest = async () => {
				try {
					if (!ai.availability.ok)
						throw new Error(t(availabilityKey(ai.availability)));
					trackEvent("ai_keyword_suggestion_requested", {
						provider: ai.source,
						...(ai.source === "desktop" ? { effort: settings.effort } : {}),
					});
					const suggestion = await executeLocalizedPrompt({
						feature: "keyword_suggestion",
						source: ai.source,
						prompt: buildKeywordSuggestionPrompt({
							name: request.name,
							context: request.context,
							...options,
							language,
							instructions: prompts.keywordPrompt,
							imageInstructions: prompts.imagePrompt,
							novelContext,
						}),
						language,
						settings,
						signal: controller.signal,
						parse: (output) =>
							parseKeywordSuggestion(
								output,
								options.categories,
								options.natures,
								options.translations,
							),
						texts: (result) => [result.description],
					});
					if (!controller.signal.aborted)
						setState({
							status: "ready",
							suggestion,
						});
				} catch (error: unknown) {
					if (!controller.signal.aborted)
						setState({
							status: "error",
							message: await aiErrorMessage(error, "keyword_suggestion", t),
						});
				}
			};
			const draw = async () => {
				if (!request.generateImage || drawing.signal.aborted) return;
				try {
					let prompt = buildCharacterImagePrompt({
						name: request.name,
						otherNames: [],
						description: "",
						instructions: prompts.imagePrompt,
						chapterExcerpts: [
							`${request.context.before}${request.name}${request.context.after}`,
						],
						novelContext,
					});
					if (novelId)
						prompt = await withImageContinuity({
							novelId,
							names: [request.name],
							prompt,
						});
					if (drawing.signal.aborted) return;
					setImage({ status: "loading" });
					if (!imageAvailability.ok)
						throw new Error(t(availabilityKey(imageAvailability)));
					trackEvent("ai_image_generation_requested", {
						provider: imageAi.source,
						has_novel_context: !!novelContext,
					});
					const result = await generateCharacterImage({
						source: imageAi.source,
						settings: imageAi.desktop,
						name: request.name,
						prompt,
						signal: drawing.signal,
					});
					if (!drawing.signal.aborted) setImage({ status: "ready", ...result });
				} catch (error: unknown) {
					if (!drawing.signal.aborted) {
						const message = await aiErrorMessage(error, "character_image", t);
						if (drawing.signal.aborted) return;
						setImage((current) => ({
							status: "error",
							message,
							prompt: current.prompt,
						}));
					}
				}
			};
			// Both requests start from the picked text; neither waits for the other.
			await Promise.all([suggest(), draw()]);
			if (!controller.signal.aborted) finished.current = true;
		})().catch(async (error: unknown) => {
			if (controller.signal.aborted) return;
			finished.current = true;
			setState({
				status: "error",
				message: await aiErrorMessage(error, "keyword_suggestion", t),
			});
			if (request.generateImage && !drawing.signal.aborted) {
				const message = await aiErrorMessage(error, "character_image", t);
				if (drawing.signal.aborted) return;
				setImage((current) => ({
					status: "error",
					message,
					prompt: current.prompt,
				}));
			}
		});
		return () => {
			controller.abort();
			drawing.abort();
			if (requestController.current === controller)
				requestController.current = null;
			if (imageController.current === drawing) imageController.current = null;
		};
	}, [request, enabled, loaded, lookupsReady, language, novelId]);
	// The launcher keeps the popup and shows progress while the suggestion is written.
	useLauncherWork({
		working: state.status === "loading" || image.status === "loading",
		failed: state.status === "error" || image.status === "error",
	});
	// Listed under the launcher until the form holding the suggestion closes.
	useAiTask({
		operation: "suggest-keyword",
		subject: request?.name ?? "",
		working: state.status === "loading",
		failed: state.status === "error",
		holding: state.status === "ready",
	});

	useAiTask({
		operation: "generate-image",
		subject: request?.name ?? "",
		working: image.status === "loading",
		failed: image.status === "error",
		holding: image.status === "ready",
	});
	return {
		state,
		image,
		stopImage: () => {
			const active = imageController.current;
			if (image.status !== "loading" || !active || active.signal.aborted)
				return;
			imageStopped.current = true;
			active.abort();
			setImage((current) => ({ status: "stopped", prompt: current.prompt }));
			trackEvent("ai_image_generation_stopped");
		},
		clear: () => {
			// Closing the form consumes this selection, even before its last promise settles.
			finished.current = true;
			requestController.current?.abort();
			imageController.current?.abort();
			setState({ status: "idle" });
			setImage({ status: "idle" });
		},
	};
}
