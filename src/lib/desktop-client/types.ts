export type DesktopModel = {
	id: string;
	provider: "claude" | "codex";
	providerModel: string;
	label: string;
	efforts: string[];
	defaultEffort: string;
	aliases: string[];
};
export type DesktopCapabilities = {
	protocolVersion: 2;
	models: DesktopModel[];
	providers: {
		provider: "claude" | "codex";
		available: boolean;
		error?: string;
	}[];
	limits: {
		promptBytes: number;
		outputBytes: number;
		timeoutMs: number;
		concurrent: number;
	};
	/** Optional features; clients before image generation omit this object. */
	features?: { webSearch: boolean; imageGeneration: boolean };
};
export type ExecutePromptInput = {
	requestId: string;
	prompt: string;
	model: string;
	effort: string;
	responseLanguage: "en" | "ar";
	/** Lets the provider search the web, used to research a novel's context. */
	webSearch?: boolean;
};
export type GenerateImageInput = {
	requestId: string;
	prompt: string;
	model: string;
	effort: string;
};
export type GeneratedImage = {
	mimeType: string;
	data: string;
	revisedPrompt?: string;
};
export type DesktopSettings = {
	port: number;
	token: string;
	model: string;
	effort: string;
};
export const DESKTOP_SETTINGS_KEY = "storylens-desktop-client";
