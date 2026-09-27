import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { trackEvent } from "@/lib/analytics/client";
import { toAiLanguage } from "@/lib/desktop-client/ai-language";
import {
	buildKeywordSuggestionPrompt,
	decodeKeywordContext,
	KEYWORD_CONTEXT_PARAM,
	type KeywordSuggestion,
	parseKeywordSuggestion,
} from "@/lib/desktop-client/keyword-suggestion";
import { executeLocalizedPrompt } from "@/lib/desktop-client/localized-prompt";
import { desktopSettings } from "@/lib/desktop-client/settings";
import { useAiConfigured } from "@/lib/desktop-client/use-ai-configured";
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
 * selection panel with AI enabled. The page context arrives in a hidden query parameter.
 */
export function useKeywordSuggestion(enabled: boolean): KeywordSuggestionState {
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
	const aiConfigured = useAiConfigured();

	useEffect(() => {
		if (
			!request ||
			!enabled ||
			!aiConfigured ||
			!lookupsReady ||
			finished.current
		)
			return;
		const controller = new AbortController();
		setState({ status: "loading" });
		void (async () => {
			const settings = await desktopSettings();
			if (controller.signal.aborted) return;
			if (!settings.token || !settings.model || !settings.effort)
				throw new Error(t("desktop.selectModel"));
			const options = {
				categories: lookups.current.categories ?? [],
				natures: lookups.current.natures ?? [],
			};
			trackEvent("ai_keyword_suggestion_requested", {
				effort: settings.effort,
			});
			const suggestion = await executeLocalizedPrompt({
				prompt: buildKeywordSuggestionPrompt({
					...request,
					...options,
					language,
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
		})().catch((error: unknown) => {
			if (controller.signal.aborted) return;
			finished.current = true;
			setState({
				status: "error",
				message:
					error instanceof Error ? error.message : t("coloring.aiFailed"),
			});
		});
		return () => controller.abort();
	}, [request, enabled, aiConfigured, lookupsReady, language, t]);

	return state;
}
