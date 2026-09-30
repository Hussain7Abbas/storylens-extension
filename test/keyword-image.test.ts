import { describe, expect, test } from "bun:test";
import {
	enrichKeywords,
	resolveKeywordInfo,
} from "../src/utils/resolve-keyword-version";
import {
	alias,
	baseVersion,
	image,
	keyword,
	version,
} from "./helpers/keywords";

const keywordImage = image("keyword-image");
const aliasImage = image("alias-image");
const versionImage = image("version-image");

describe("tooltip image of an alias", () => {
	test("shows the alias's own image without needing the style override", () => {
		const own = alias({ id: "alias-1", image: aliasImage });
		const raw = keyword({
			aliases: [own],
			versions: [baseVersion({ image: keywordImage })],
		});

		const info = resolveKeywordInfo(raw, own, 5, "en");

		expect(info.image.value?.url).toBe(aliasImage.url);
		expect(info.image.source).toBe("alias");
		expect(info.image.overrides).toEqual([
			{ source: "keyword", value: keywordImage },
		]);
	});

	test("falls back to the parent keyword's image when the alias has none", () => {
		const bare = alias({ id: "alias-1" });
		const raw = keyword({
			aliases: [bare],
			versions: [baseVersion({ image: keywordImage })],
		});

		const info = resolveKeywordInfo(raw, bare, 5, "en");

		expect(info.image.value?.url).toBe(keywordImage.url);
		expect(info.image.source).toBe("keyword");
	});

	test("prefers the alias's image over the active version's", () => {
		const own = alias({ id: "alias-1", image: aliasImage });
		const raw = keyword({
			aliases: [own],
			versions: [
				baseVersion({ image: keywordImage, endingChapter: 9 }),
				version({ id: "version-2", startingChapter: 10, image: versionImage }),
			],
		});

		const info = resolveKeywordInfo(raw, own, 12, "en");

		expect(info.image.value?.url).toBe(aliasImage.url);
		expect(info.image.overrides).toEqual([
			{ source: "version", value: versionImage },
			{ source: "keyword", value: keywordImage },
		]);
	});

	test("falls back to the active version's image, then the base one", () => {
		const bare = alias({ id: "alias-1" });
		const versions = [
			baseVersion({ image: keywordImage, endingChapter: 9 }),
			version({ id: "version-2", startingChapter: 10, image: versionImage }),
		];
		const raw = keyword({ aliases: [bare], versions });

		expect(resolveKeywordInfo(raw, bare, 12, "en").image.value?.url).toBe(
			versionImage.url,
		);
		expect(resolveKeywordInfo(raw, bare, 3, "en").image.value?.url).toBe(
			keywordImage.url,
		);
	});

	test("an image still waiting to upload (no URL yet) falls back to the parent", () => {
		const pending = alias({
			id: "alias-1",
			imageId: "local-file",
			image: null,
		});
		const raw = keyword({
			aliases: [pending],
			versions: [baseVersion({ image: keywordImage })],
		});

		expect(resolveKeywordInfo(raw, pending, 5, "en").image.value?.url).toBe(
			keywordImage.url,
		);
	});

	test("shows nothing when neither the alias nor the keyword has an image", () => {
		const bare = alias({ id: "alias-1" });
		const raw = keyword({ aliases: [bare] });

		expect(resolveKeywordInfo(raw, bare, 5, "en").image.value).toBeNull();
	});

	test("a keyword's own tooltip keeps its image", () => {
		const own = alias({ id: "alias-1", image: aliasImage });
		const raw = keyword({
			aliases: [own],
			versions: [baseVersion({ image: keywordImage })],
		});

		const info = resolveKeywordInfo(raw, null, 5, "en");

		expect(info.image.value?.url).toBe(keywordImage.url);
		expect(info.image.source).toBe("keyword");
	});

	test("the style override still decides category, not the image", () => {
		const own = alias({ id: "alias-1", image: aliasImage });
		const raw = keyword({ aliases: [own] });

		const info = resolveKeywordInfo(raw, own, 5, "en");

		expect(info.category.source).toBe("keyword");
		expect(info.image.source).toBe("alias");
	});
});

describe("enriched alias entries", () => {
	test("carry the alias's image, or the keyword's when it has none", () => {
		const own = alias({ id: "alias-own", nameEn: "Own", image: aliasImage });
		const bare = alias({ id: "alias-bare", nameEn: "Bare" });
		const raw = keyword({
			aliases: [own, bare],
			versions: [baseVersion({ image: keywordImage })],
		});

		const enriched = enrichKeywords([raw], 5, "en");
		const byId = (id: string) => enriched.find((item) => item.id === id);

		expect(byId("alias-own")?.image?.url).toBe(aliasImage.url);
		expect(byId("alias-own")?.imageId).toBe(aliasImage.id);
		expect(byId("alias-bare")?.image?.url).toBe(keywordImage.url);
		expect(byId("keyword-1")?.image?.url).toBe(keywordImage.url);
	});
});
