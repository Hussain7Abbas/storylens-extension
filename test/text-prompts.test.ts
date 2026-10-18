import { expect, test } from "bun:test";
import { buildContextPrompt } from "../src/lib/chapter-context/prompt";
import { DEFAULT_AI_PROMPTS } from "../src/lib/desktop-client/ai-prompts";
import { buildPageSummaryPrompt } from "../src/lib/desktop-client/summary-prompt";
import { coverChapter } from "./helpers/chapter-cover";

for (const language of ["en", "ar"] as const) {
	test(`chapter context applies shared instructions while retaining structured output in ${language}`, () => {
		const data = { ...coverChapter(), language };
		const prompt = buildContextPrompt(
			data,
			"Mira entered the shrine.",
			'{"id":"known-id","names":["Mira"]}',
			"Describe the lighting and equipment in detail.",
		);
		expect(prompt).toContain(
			"<INSTRUCTIONS>\nDescribe the lighting and equipment in detail.\n</INSTRUCTIONS>",
		);
		expect(prompt).toContain('"schemaVersion":1');
		expect(prompt).toContain('"stateChanges"');
		expect(prompt).toContain("canonical keyword UUID");
		expect(prompt).toContain(
			"Use the current chapter for scene membership, actions and new changes",
		);
		expect(prompt).toContain(
			'<REGISTRY>{"id":"known-id","names":["Mira"]}</REGISTRY>',
		);
		expect(prompt).toContain("<CHAPTER>Mira entered the shrine.</CHAPTER>");
		expect(prompt).toContain(
			language === "ar" ? "Arabic (العربية) only" : "English only",
		);
	});
	test(`page summary uses shared instructions and the requested ${language} output`, () => {
		const prompt = buildPageSummaryPrompt(
			"Mira entered the shrine.",
			language,
			"Use three concise bullet points.",
		);
		expect(prompt).toContain(
			"<INSTRUCTIONS>\nUse three concise bullet points.\n</INSTRUCTIONS>",
		);
		expect(prompt).toContain(
			language === "ar" ? "Arabic (العربية) only" : "English only",
		);
		expect(prompt).toContain("Return plain text only");
		expect(prompt).toContain("<PAGE>\nMira entered the shrine.\n</PAGE>");
	});
}
test("new text features have defaults when no shared override exists", () => {
	expect(buildContextPrompt(coverChapter(), "Chapter text", "")).toContain(
		DEFAULT_AI_PROMPTS.chapterContextPrompt,
	);
	expect(buildPageSummaryPrompt("Page text", "en")).toContain(
		DEFAULT_AI_PROMPTS.pageSummaryPrompt,
	);
});
