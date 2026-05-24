import { customInstance } from "@/api/axios-instance";

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
	const response = await customInstance<DetectChapterSelectorsResponse>({
		url: "/ai/chapter-selectors",
		method: "POST",
		headers: { "Content-Type": "application/json" },
		data: input,
	});

	return response.data;
}
