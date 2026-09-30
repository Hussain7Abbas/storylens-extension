import { trackEvent } from "@/lib/analytics/client";
import { isAiConfigured } from "@/lib/desktop-client/ai-config";
import { toAiLanguage } from "@/lib/desktop-client/ai-language";
import { detectChapterSelectorsWithDesktop } from "@/lib/desktop-client/selector-detection-runner";
import { detectChapterSelectorsWithProviders } from "@/lib/desktop-client/selector-provider";
import { desktopSettings } from "@/lib/desktop-client/settings";
import { extensionApiPost } from "@/utils/api-proxy-client";

export type NodeSelectorFormValues = {
	website: string;
	novelXpath: string;
	novelXpathRegex: string;
	novelUrlRegex: string;
	chapterXpath: string;
	chapterXpathRegex: string;
	chapterUrlRegex: string;
};

export type DetectChapterSelectorsResponse = {
	result: {
		website: string;
		confidence: "high" | "medium" | "low";
		notes?: string;
	};
	nodeSelectorForm: NodeSelectorFormValues;
	novelForm: {
		name: string;
		description: string;
		slugs: string[];
	};
	validation: {
		novelSlug: string | null;
		novelName: string | null;
		chapter: number | null;
		errors: string[];
	};
};

type DetectionInput = {
	url: string;
	html: string;
	language: string;
	signal: AbortSignal;
};

type Detection = Pick<
	DetectChapterSelectorsResponse,
	"result" | "nodeSelectorForm" | "validation"
>;

export async function detectChapterSelectors(
	input: DetectionInput,
): Promise<Detection> {
	const settings = await desktopSettings();
	if (input.signal.aborted) throw new DOMException("Aborted", "AbortError");
	const paired = isAiConfigured(settings);
	trackEvent("ai_selector_detection_requested", {
		provider: paired ? "desktop" : "openrouter",
		...(paired ? { effort: settings.effort } : {}),
	});
	return detectChapterSelectorsWithProviders(input, {
		settings: async () => settings,
		desktop: (data) =>
			detectChapterSelectorsWithDesktop({
				...data,
				language: toAiLanguage(data.language),
			}),
		backend: detectChapterSelectorsViaBackend,
	});
}

async function detectChapterSelectorsViaBackend(input: {
	url: string;
	html: string;
}): Promise<DetectChapterSelectorsResponse> {
	return extensionApiPost<DetectChapterSelectorsResponse>(
		"/api/user/ai/chapter-selectors",
		input,
	);
}
