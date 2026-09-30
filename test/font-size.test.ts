import { describe, expect, it } from "bun:test";
import {
	FONT_SIZE_DEFAULT,
	FONT_SIZE_MAX,
	FONT_SIZE_MIN,
	parseFontSize,
} from "../src/lib/font-size";

describe("font size range", () => {
	it("keeps 18 to 42 and uses 24 for anything else", () => {
		expect([FONT_SIZE_MIN, FONT_SIZE_MAX, FONT_SIZE_DEFAULT]).toEqual([
			18, 42, 24,
		]);
		for (const kept of [18, 22, 24, 30.5, 42])
			expect(parseFontSize(kept)).toBe(kept);
		// 14 was the earlier default; 10 to 17 were valid before.
		for (const reset of [14, 10, 17.9, 42.1, 100, 0, -5, Number.NaN])
			expect(parseFontSize(reset)).toBe(24);
		for (const invalid of ["30", null, undefined, {}])
			expect(parseFontSize(invalid)).toBe(24);
	});
});
