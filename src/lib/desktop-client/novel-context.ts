import {
	getNovelsById,
	putNovelsByIdContext,
} from "@/api/generated/endpoints/novels";
import { sendMessage } from "@/entrypoints/background/messaging";
import { trackEvent } from "@/lib/analytics/client";
import { offlineDb } from "@/lib/offline/db";
import { isOnline } from "@/lib/offline/online-status";
import { descriptionIn, nameIn } from "@/utils/translation";
import type { AiLanguage } from "./ai-language";
import { executeLocalizedPrompt } from "./localized-prompt";
import {
	buildNovelContextPrompt,
	NOVEL_CONTEXT_CHARS,
	type NovelInfo,
} from "./novel-context-prompt";
import type { DesktopSettings } from "./types";

type TranslatedNovel = Omit<NovelInfo, "name" | "description"> & {
	nameAr: string | null;
	nameEn: string | null;
	descriptionAr: string | null;
	descriptionEn: string | null;
};

/** The prompt reads the AI language's title, or the other one when it is missing. */
function toNovelInfo(novel: TranslatedNovel, language: AiLanguage): NovelInfo {
	const [first, second] =
		language === "ar" ? (["ar", "en"] as const) : (["en", "ar"] as const);
	return {
		id: novel.id,
		slugs: novel.slugs,
		context: novel.context,
		name: nameIn(novel, first) || nameIn(novel, second),
		description: descriptionIn(novel, first) || descriptionIn(novel, second),
	};
}

async function loadNovel(
	novelId: string,
	language: AiLanguage,
): Promise<NovelInfo | undefined> {
	if (isOnline()) {
		try {
			return toNovelInfo((await getNovelsById(novelId)).data, language);
		} catch {
			// Fall back to the offline copies below.
		}
	}
	const novel = await offlineDb().novels.get(novelId);
	return novel ? toNovelInfo(novel, language) : undefined;
}

/**
 * Returns the novel's global context. When the novel has none yet, the AI
 * researches the novel online and the result is saved to the novel so every
 * later AI action reuses it. Failures leave the context empty rather than
 * blocking the AI action that asked for it.
 */
export async function ensureNovelContext(input: {
	novelId: string;
	language: AiLanguage;
	settings: DesktopSettings;
	signal: AbortSignal;
}): Promise<string> {
	const novel = await loadNovel(input.novelId, input.language).catch(
		() => undefined,
	);
	if (!novel) return "";
	const existing = novel.context?.trim();
	// Stored text is plain (the API no longer HTML-escapes it).
	if (existing) return existing.slice(0, NOVEL_CONTEXT_CHARS);
	if (!isOnline()) return "";
	try {
		const context = await executeLocalizedPrompt({
			prompt: buildNovelContextPrompt(novel, input.language),
			language: input.language,
			settings: input.settings,
			signal: input.signal,
			webSearch: true,
			parse: (output) => output.trim().slice(0, NOVEL_CONTEXT_CHARS),
			texts: (result) => [result],
		});
		if (!context) return "";
		trackEvent("ai_novel_context_generated", { effort: input.settings.effort });
		try {
			await putNovelsByIdContext(input.novelId, { context });
			// The runner pulls the novel; only it writes the local snapshot.
			void sendMessage("requestNovelRefresh", input.novelId).catch(
				() => undefined,
			);
		} catch {
			// Saving is best effort: someone may have written a context meanwhile.
		}
		return context;
	} catch (error) {
		if (input.signal.aborted) throw error;
		return "";
	}
}
