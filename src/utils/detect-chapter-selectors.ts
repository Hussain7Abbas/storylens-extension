import { availabilityKey } from "@/lib/ai-source/availability";
import { aiState } from "@/lib/ai-source/storage";
import { trackEvent } from "@/lib/analytics/client";
import { toAiLanguage } from "@/lib/desktop-client/ai-language";
import { detectChapterSelectorsWithDesktop } from "@/lib/desktop-client/selector-detection-runner";
import { detectChapterSelectorsWithProviders } from "@/lib/desktop-client/selector-provider";
import i18n from "@/utils/i18n";

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
	const ai = await aiState("selector_detection");
	if (input.signal.aborted) throw new DOMException("Aborted", "AbortError");
	if (!ai.availability.ok)
		throw new Error(i18n.t(availabilityKey(ai.availability)));
	trackEvent("ai_selector_detection_requested", {
		provider: ai.source,
		...(ai.source === "desktop" ? { effort: ai.desktop.effort } : {}),
	});
	const run = (data: DetectionInput) =>
		detectChapterSelectorsWithDesktop({
			...data,
			settings: ai.desktop,
			source: ai.source,
			language: toAiLanguage(data.language),
		});
	return detectChapterSelectorsWithProviders(input, {
		source: ai.source,
		settings: async () => ai.desktop,
		desktop: run,
		cloud: run,
	});
}
