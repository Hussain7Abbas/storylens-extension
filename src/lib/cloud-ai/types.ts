import type { AiFeature, AiSource } from "../ai-source/source";
export type AiPromptInput = {
	source: AiSource;
	requestId: string;
	actionId: string;
	attempt: 1 | 2;
	feature: Exclude<AiFeature, "character_image">;
	prompt: string;
	responseLanguage: "en" | "ar";
	novelId?: string;
	model: string;
	effort: string;
	webSearch?: boolean;
};
export type AiImageInput = {
	source: AiSource;
	requestId: string;
	actionId: string;
	prompt: string;
	model: string;
	effort: string;
};
