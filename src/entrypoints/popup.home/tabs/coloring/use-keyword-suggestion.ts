import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { availabilityKey } from "@/lib/ai-source/availability";
import { useAiSnapshot } from "@/lib/ai-source/hooks";
import { aiState } from "@/lib/ai-source/storage";
import { trackEvent } from "@/lib/analytics/client";
import { aiErrorMessage } from "@/lib/cloud-ai/top-up";
import { toAiLanguage } from "@/lib/desktop-client/ai-language";
import {
	buildKeywordSuggestionPrompt,
	decodeKeywordContext,
	KEYWORD_CONTEXT_PARAM,
	type KeywordSuggestion,
	parseKeywordSuggestion,
} from "@/lib/desktop-client/keyword-suggestion";
import { executeLocalizedPrompt } from "@/lib/desktop-client/localized-prompt";
import { ensureNovelContext } from "@/lib/desktop-client/novel-context";
import { aiPrompts } from "@/lib/desktop-client/settings";
import { useAiTask } from "@/lib/launcher-frame/use-ai-task";
import { useLauncherWork } from "@/lib/launcher-frame/use-launcher-work";
import {
	useOfflineKeywordCategories,
	useOfflineKeywordNatures,
} from "@/lib/offline/hooks";

export type KeywordSuggestionState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "ready"; suggestion: KeywordSuggestion }
	| { status: "error"; message: string };

/**
 * Requests a description, category, and nature for the text picked with the
 * selection panel with AI enabled. The page context arrives in a hidden query parameter;
 * the reader's keyword prompt and the novel's global context are added to it.
 */
export function useKeywordSuggestion(
	enabled: boolean,
	novelId: string | undefined,
): { state: KeywordSuggestionState; clear: () => void } {
	const { t, i18n } = useTranslation();
	const request = useMemo(() => {
		const params = new URLSearchParams(window.location.search);
		const name = params.get("search")?.trim();
		const context = decodeKeywordContext(params.get(KEYWORD_CONTEXT_PARAM));
		return name && context ? { name, context } : undefined;
	}, []);
	const { data: categories } = useOfflineKeywordCategories();
	const { data: natures } = useOfflineKeywordNatures();
	const lookups = useRef({ categories, natures });
	lookups.current = { categories, natures };
	const lookupsReady = !!categories && !!natures;
	const [state, setState] = useState<KeywordSuggestionState>({
		status: "idle",
	});
	const finished = useRef(false);
	const language = toAiLanguage(i18n.language);
	const { loaded } = useAiSnapshot();

	useEffect(() => {
		if (!request || !loaded || !enabled || !lookupsReady || finished.current)
			return;
		const controller = new AbortController();
		setState({ status: "loading" });
		void (async () => {
			const ai = await aiState("keyword_suggestion");
			const settings = ai.desktop;
			if (controller.signal.aborted) return;
			if (!ai.availability.ok)
				throw new Error(t(availabilityKey(ai.availability)));
			const options = {
				categories: lookups.current.categories ?? [],
				natures: lookups.current.natures ?? [],
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
							signal: controller.signal,
						})
					: "",
			]);
			if (controller.signal.aborted) return;
			trackEvent("ai_keyword_suggestion_requested", {
				provider: ai.source,
				...(ai.source === "desktop" ? { effort: settings.effort } : {}),
			});
			const suggestion = await executeLocalizedPrompt({
				feature: "keyword_suggestion",
				source: ai.source,
				prompt: buildKeywordSuggestionPrompt({
					...request,
					...options,
					language,
					instructions: prompts.keywordPrompt,
					novelContext,
				}),
				language,
				settings,
				signal: controller.signal,
				parse: (output) =>
					parseKeywordSuggestion(output, options.categories, options.natures),
				texts: (result) => [result.description],
			});
			if (controller.signal.aborted) return;
			finished.current = true;
			setState({ status: "ready", suggestion });
		})().catch(async (error: unknown) => {
			if (controller.signal.aborted) return;
			finished.current = true;
			setState({
				status: "error",
				message: await aiErrorMessage(error, "keyword_suggestion", t),
			});
		});
		return () => controller.abort();
	}, [request, enabled, loaded, lookupsReady, language, novelId, t]);
	// The launcher keeps the popup and shows progress while the suggestion is written.
	useLauncherWork({
		working: state.status === "loading",
		failed: state.status === "error",
	});
	// Listed under the launcher until the form holding the suggestion closes.
	useAiTask({
		operation: "suggest-keyword",
		subject: request?.name ?? "",
		working: state.status === "loading",
		failed: state.status === "error",
		holding: state.status === "ready",
	});

	return { state, clear: () => setState({ status: "idle" }) };
}
