import { describe, expect, test } from "bun:test";
import { fuzzyMatches } from "../src/utils/fuzzy-search";

describe("popup fuzzy search", () => {
	test("matches case, spacing and partial names", () => {
		expect(fuzzyMatches("  HARRY   pot ", ["Harry Potter"])).toBe(true);
	});
	test("tolerates missing, extra, replaced and swapped letters", () => {
		for (const query of [
			"harry poter",
			"harry pottter",
			"harry pottar",
			"harry potter",
			"harry ptoter",
		]) {
			expect(fuzzyMatches(query, ["Harry Potter"])).toBe(true);
		}
	});
	test("matches aliases and replacement destinations", () => {
		expect(fuzzyMatches("hermoine", ["Hermione Granger", "Miss Granger"])).toBe(
			true,
		);
		expect(fuzzyMatches("granger", ["hermione", "Miss Granger"])).toBe(true);
	});
	test("requires every query word and avoids unrelated short words", () => {
		expect(fuzzyMatches("harry malfoy", ["Harry Potter"])).toBe(false);
		expect(fuzzyMatches("ab", ["ac"])).toBe(false);
		expect(fuzzyMatches("voldemort", ["Harry Potter"])).toBe(false);
	});
	test("supports Arabic and empty searches", () => {
		expect(fuzzyMatches("هاري بوتر", ["هاري بوتر"])).toBe(true);
		expect(fuzzyMatches("هاري بورت", ["هاري بوتر"])).toBe(true);
		expect(fuzzyMatches(" ", [null])).toBe(true);
	});
});
