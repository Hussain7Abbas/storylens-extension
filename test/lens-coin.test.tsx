import { describe, expect, test } from "bun:test";
import { createInstance } from "i18next";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ar from "../public/locales/ar.json";
import en from "../public/locales/en.json";
import { LensCoin } from "../src/components/lens/lens-coin";
import { formatLenses, LENS_COIN_MONO } from "../src/lib/lens-coin";

async function translator(lng: "en" | "ar") {
	const i18n = createInstance();
	await i18n.init({
		lng,
		resources: { en: { translation: en }, ar: { translation: ar } },
	});
	return (count: number) =>
		i18n.t("lens.count", { count, formatted: formatLenses(count, lng) });
}

describe("lens labels", () => {
	test("English has one and other", async () => {
		const label = await translator("en");
		expect([1, 2, 3, 11, 100, 1500].map(label)).toEqual([
			"1 lens",
			"2 lenses",
			"3 lenses",
			"11 lenses",
			"100 lenses",
			"1,500 lenses",
		]);
	});

	test("Arabic uses all its plural forms with Latin digits", async () => {
		const label = await translator("ar");
		expect([1, 2, 3, 10, 11, 99, 100, 1500].map(label)).toEqual([
			"عدسة واحدة",
			"عدستان",
			"3 عدسات",
			"10 عدسات",
			"11 عدسة",
			"99 عدسة",
			"100 عدسة",
			"1,500 عدسة",
		]);
	});
});

describe("LensCoin", () => {
	const markup = (props: Parameters<typeof LensCoin>[0]) =>
		renderToStaticMarkup(createElement(LensCoin, props));

	test("uses the small artwork up to 20 px and the full coin above", () => {
		expect(markup({ size: 16 })).toContain('r="28"');
		expect(markup({ size: 16 })).not.toContain("linearGradient");
		expect(markup({ size: 24 })).toContain("linearGradient");
	});

	test("the line coin follows the text color and is hidden unless named", () => {
		const mono = markup({ variant: "mono" });
		expect(mono).toContain('stroke="currentColor"');
		expect(mono).toContain('aria-hidden="true"');
		expect(markup({ title: "Lens" })).toContain('aria-label="Lens"');
	});

	test("the launcher node draws the same line coin", () => {
		expect(LENS_COIN_MONO.map(([tag]) => tag)).toEqual(["circle", "path"]);
	});
});
