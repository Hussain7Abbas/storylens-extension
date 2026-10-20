import { describe, expect, it } from "bun:test";
import { lookupOptions } from "../src/utils/lookup-options";

describe("lookup select options", () => {
	it("rejects malformed values and labels and deduplicates usable IDs", () => {
		const rows = [
			null,
			"old entry",
			{},
			{ id: 12, nameEn: "Numeric ID" },
			{ id: "", nameEn: "No ID" },
			{ id: "blank", nameEn: "  " },
			{ id: "hero", nameEn: { text: "Broken" }, nameAr: 12 },
			{ id: "hero", nameEn: "Hero", nameAr: "بطل" },
			{ id: "hero", nameEn: "Duplicate" },
			{ id: "place", nameEn: null, nameAr: "مكان" },
		];
		expect(lookupOptions(rows, "en")).toEqual([
			{ value: "hero", label: "Hero" },
			{ value: "place", label: "مكان" },
		]);
		expect(lookupOptions(rows, "ar")).toEqual([
			{ value: "hero", label: "بطل" },
			{ value: "place", label: "مكان" },
		]);
		// Display validation must not rewrite downloaded data.
		expect(rows[8]).toEqual({ id: "hero", nameEn: "Duplicate" });
	});

	it("uses the other nonblank language and accepts unloaded data", () => {
		expect(
			lookupOptions([{ id: "x", nameEn: " ", nameAr: "  بطل  " }], "en"),
		).toEqual([{ value: "x", label: "بطل" }]);
		expect(lookupOptions(undefined, "ar")).toEqual([]);
	});
});
