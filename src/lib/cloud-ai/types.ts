import type { AiFeature, AiImageFeature, AiSource } from "../ai-source/source";
export type AiPromptInput = {
	source: AiSource;
	requestId: string;
	actionId: string;
	attempt: 1 | 2;
	feature: Exclude<AiFeature, AiImageFeature>;
	prompt: string;
	responseLanguage: "en" | "ar";
	novelId?: string;
	model: string;
	effort: string;
	webSearch?: boolean;
};
export type AiImageInput = {
	feature?: AiImageFeature;
	referenceImageUrls?: string[];
	source: AiSource;
	requestId: string;
	actionId: string;
	prompt: string;
	model: string;
	effort: string;
};
