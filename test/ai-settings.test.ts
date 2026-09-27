import { describe, expect, test } from "bun:test";
import { isAiConfigured } from "@/lib/desktop-client/ai-config";

describe("isAiConfigured", () => {
	test("is false before pairing", () => {
		expect(isAiConfigured({ token: "", model: "", effort: "" })).toBe(false);
	});

	test("is false when paired without a model or effort", () => {
		expect(isAiConfigured({ token: "t", model: "", effort: "" })).toBe(false);
		expect(isAiConfigured({ token: "t", model: "m", effort: "" })).toBe(false);
		expect(isAiConfigured({ token: "t", model: "", effort: "low" })).toBe(
			false,
		);
	});

	test("is true with token, model, and effort", () => {
		expect(isAiConfigured({ token: "t", model: "m", effort: "low" })).toBe(
			true,
		);
	});
});
