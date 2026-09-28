import type { AiLanguage } from "./ai-language";

/** Longest context kept in prompts and accepted by the API. */
export const NOVEL_CONTEXT_CHARS = 6_000;

const ENTITIES: Record<string, string> = {
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#x27;": "'",
	"&amp;": "&",
};

/** The API escapes HTML characters in stored text; prompts need the plain text back. */
export function decodeStoredText(value: string): string {
	return value.replace(
		/&(lt|gt|quot|amp|#x27);/g,
		(entity) => ENTITIES[entity],
	);
}

export type NovelInfo = {
	id: string;
	name: string;
	slugs: string[];
	description?: string | null;
	context?: string | null;
};

export function buildNovelContextPrompt(
	novel: NovelInfo,
	language: AiLanguage,
): string {
	const known = [
		`Title: ${novel.name}`,
		novel.slugs.length
			? `Other titles or URL slugs: ${novel.slugs.join(", ")}`
			: "",
		novel.description?.trim()
			? `Reader's description: ${decodeStoredText(novel.description)}`
			: "",
	]
		.filter(Boolean)
		.join("\n");
	return `Search the web for the web novel below and write a short background brief that other AI tasks will use as its global context (keyword descriptions and character illustrations).

${known}

Write plain text, at most 250 words, with these labelled lines:
Genre: …
Setting: world, era, culture and technology level (for example ancient Chinese cultivation world, modern Korean city, western fantasy kingdom).
Power system: cultivation realms, magic, skills, or "none".
Premise: two or three sentences about the starting situation, without spoilers beyond the early chapters.
Main characters: the protagonist and up to five important early characters, one line each with their role and typical appearance.
Tone and visual style: the mood and how illustrations of this novel should feel.

Use your own words; do not quote or copy passages from the novel or from websites. If the search finds nothing reliable, infer carefully from the title and say which lines are guesses. Write the brief in ${language === "ar" ? "Arabic (العربية)" : "English"}, keeping character and place names as they are commonly written.`;
}

/** Prompt section carrying the novel's global context, or nothing when it is empty. */
export function novelContextSection(context: string): string {
	return context.trim()
		? `Novel context (background about the whole novel; the chapter text wins when they disagree):
<NOVEL_CONTEXT>
${context.trim()}
</NOVEL_CONTEXT>`
		: "";
}
