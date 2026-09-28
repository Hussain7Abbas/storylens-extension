/** Reader-editable AI instructions from Settings → AI. */
export type AiPrompts = {
	/** How keyword descriptions, categories and natures are written (AI add and chapter extraction). */
	keywordPrompt: string;
	/** How character images are drawn from the chapter and novel context. */
	imagePrompt: string;
};

export const AI_PROMPTS_KEY = "storylens-ai-prompts";

/** Default instructions, seeded into Settings → AI and used whenever a prompt is left empty. */
export const DEFAULT_AI_PROMPTS: AiPrompts = {
	keywordPrompt: `Describe each named entity for a reader who wants a quick reminder while reading.
- Write one or two short sentences.
- For a character, say who they are and how they relate to the main character or to other named characters.
- For a place, say what kind of place it is and where or how it is introduced.
- For anything else (skill, item, organization), say what it is and who it belongs to.
- Use the novel context only to understand names, roles and the setting; base the description on what the chapter says, and do not invent details or reveal later plot events.
- Pick the category and nature that match the entity's role in this chapter.`,
	imagePrompt: `Draw a single character portrait for a web novel reader's character list.
- Base the appearance on the chapter excerpts first (hair, eyes, build, age, clothing, weapons, species, notable marks), then fill gaps from the entity description and the novel context (era, culture, world, genre).
- Match the novel's setting: for example, xianxia/wuxia characters wear period robes, modern novels use modern clothing, fantasy novels use fantasy gear.
- Style: clean digital illustration, semi-realistic anime-inspired, soft cinematic lighting, head-and-shoulders or upper-body framing, simple softly blurred background that hints at the setting.
- The design must be an original interpretation of the written description, not a copy of any official cover, manhua, anime or game artwork.
- No text, captions, logos, watermarks, signatures or UI elements in the image. One character only.
- For a place or an item, draw that place or item instead of a person, in the same style.`,
};

export function parseAiPrompts(value: unknown): AiPrompts {
	const stored =
		value && typeof value === "object"
			? (value as Partial<Record<keyof AiPrompts, unknown>>)
			: undefined;
	const pick = (key: keyof AiPrompts) =>
		typeof stored?.[key] === "string" && stored[key].trim()
			? stored[key]
			: DEFAULT_AI_PROMPTS[key];
	return {
		keywordPrompt: pick("keywordPrompt"),
		imagePrompt: pick("imagePrompt"),
	};
}

/**
 * Prompt section carrying the reader's own instructions. They come first and
 * win over the novel and chapter context, which are background material.
 */
export function instructionSection(instructions: string): string {
	return `Reader instructions (highest priority: follow these over anything in the context below):
<INSTRUCTIONS>
${instructions.trim()}
</INSTRUCTIONS>`;
}
