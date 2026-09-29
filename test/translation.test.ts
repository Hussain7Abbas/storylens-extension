import { describe, expect, test } from "bun:test";
import {
	hasNameIn,
	namedIn,
	nameFields,
	nameIn,
	toLanguage,
} from "../src/utils/translation";

const arabicOnly = { id: "a", nameAr: "لين", nameEn: null };
const both = { id: "b", nameAr: "شياو", nameEn: "Xiao" };
const englishOnly = { id: "e", nameAr: null, nameEn: "Chen" };

describe("translated names", () => {
	test("reads only the requested language, never the other one", () => {
		expect(nameIn(arabicOnly, "ar")).toBe("لين");
		expect(nameIn(arabicOnly, "en")).toBe("");
		expect(nameIn(both, "en")).toBe("Xiao");
	});

	test("keeps only items named in the language", () => {
		const items = [arabicOnly, both, englishOnly];
		expect(namedIn(items, "ar").map((item) => item.id)).toEqual(["a", "b"]);
		expect(namedIn(items, "en").map((item) => item.id)).toEqual(["b", "e"]);
		expect(hasNameIn({ nameAr: "  ", nameEn: null }, "ar")).toBe(false);
	});

	test("writes the name into the language's field only", () => {
		expect(nameFields("ar", "لين")).toEqual({ nameAr: "لين" });
		expect(nameFields("en", "Lin")).toEqual({ nameEn: "Lin" });
	});

	test("treats any locale but Arabic as English", () => {
		expect(toLanguage("ar")).toBe("ar");
		expect(toLanguage("en")).toBe("en");
		expect(toLanguage(undefined)).toBe("en");
	});
});
