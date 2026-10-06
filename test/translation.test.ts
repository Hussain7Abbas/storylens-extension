import { describe, expect, test } from "bun:test";
import {
	aliasDisplayName,
	aliasMatchNames,
	displayNameIn,
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

	test("matches an alias by both names and shows the UI language's first", () => {
		expect(aliasMatchNames({ nameAr: "ميرا", nameEn: "Mira" })).toEqual([
			"ميرا",
			"Mira",
		]);
		expect(aliasMatchNames({ nameAr: "007", nameEn: "007" })).toEqual(["007"]);
		expect(aliasDisplayName({ nameAr: "ميرا", nameEn: "Mira" }, "en")).toBe(
			"Mira",
		);
		expect(aliasDisplayName({ nameAr: "ميرا", nameEn: null }, "en")).toBe(
			"ميرا",
		);
	});

	test("shows a lookup in the UI language, else its other name", () => {
		// Category and nature dropdowns used to show the English name in the Arabic UI.
		expect(displayNameIn(both, "ar")).toBe("شياو");
		expect(displayNameIn(both, "en")).toBe("Xiao");
		expect(displayNameIn(englishOnly, "ar")).toBe("Chen");
		expect(displayNameIn(arabicOnly, "en")).toBe("لين");
		expect(displayNameIn({ nameAr: "", nameEn: "Hero" }, "ar")).toBe("Hero");
		expect(displayNameIn({ nameAr: null, nameEn: null }, "ar")).toBe("");
	});
});
