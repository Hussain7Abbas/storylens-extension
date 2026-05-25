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

export async function detectChapterSelectors(input: {
	url: string;
	html: string;
	model?: string;
}) {
	return extensionApiPost<DetectChapterSelectorsResponse>(
		"/ai/chapter-selectors",
		input,
	);
}
