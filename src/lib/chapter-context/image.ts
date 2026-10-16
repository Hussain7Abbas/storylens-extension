import { browser } from "#imports";
import { sendMessage } from "@/entrypoints/background/messaging";
import type { AiImageFeature } from "@/lib/ai-source/source";
import { aiState } from "@/lib/ai-source/storage";
import { nameKey } from "@/utils/arabic";
import { continuitySection } from "./prompt";

/** Called only while preparing an image (including copying its prompt). Never on page open. */
export async function withImageContinuity(input: {
	novelId: string;
	prompt: string;
	names: string[];
	chapterNumber?: number;
	feature?: AiImageFeature;
}): Promise<string> {
	try {
		let chapterNumber = input.chapterNumber;
		if (chapterNumber === undefined) {
			const [tab] = await browser.tabs.query({
				active: true,
				currentWindow: true,
			});
			if (tab?.id === undefined) return input.prompt;
			const meta = await sendMessage("getCurrentNovel", undefined, {
				tabId: tab.id,
			});
			if (!meta) return input.prompt;
			const data = await sendMessage("getNovelContentData", meta);
			if (data?.novel.id !== input.novelId) return input.prompt;
			chapterNumber = data.chapterNumber;
		}
		if (
			chapterNumber === undefined ||
			!Number.isInteger(chapterNumber) ||
			chapterNumber < 0
		)
			return input.prompt;
		const keywords = await sendMessage("chapterCoverKeywords", input.novelId);
		const names = new Set(input.names.map(nameKey));
		const entityKeys = input.names.map((name) => `name:${nameKey(name)}`);
		for (const keyword of keywords ?? []) {
			const terms = [
				keyword.nameAr,
				keyword.nameEn,
				...keyword.aliases.flatMap((alias) => [alias.nameAr, alias.nameEn]),
			];
			if (terms.some((name) => name && names.has(nameKey(name))))
				entityKeys.push(`keyword:${keyword.id}`);
		}
		const context = await sendMessage("imageContinuity", {
			novelId: input.novelId,
			chapterNumber,
			entityKeys: [...new Set(entityKeys)].slice(0, 80),
		});
		if (!context) return input.prompt;
		const state = await aiState(input.feature ?? "character_image");
		const max =
			state.source === "cloud"
				? (state.pricing?.features.find(
						(row) => row.key === (input.feature ?? "character_image"),
					)?.maxPromptChars ?? 180000)
				: 180000;
		return (
			input.prompt +
			continuitySection(
				context,
				chapterNumber,
				Math.min(28000, max - input.prompt.length),
				entityKeys,
			)
		);
	} catch {
		// Older backends and offline readers still have the chapter text and existing visual references.
		return input.prompt;
	}
}
