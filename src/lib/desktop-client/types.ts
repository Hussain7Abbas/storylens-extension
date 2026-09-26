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
};
export type ExecutePromptInput = {
	requestId: string;
	prompt: string;
	model: string;
	effort: string;
	responseLanguage: "en" | "ar";
};
export type DesktopSettings = {
	port: number;
	token: string;
	model: string;
	effort: string;
};
export const DESKTOP_SETTINGS_KEY = "storylens-desktop-client";
