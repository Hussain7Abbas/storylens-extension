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

	test("falls back to a version's image when the read versions have none", () => {
		const bare = alias({ id: "alias-1" });
		const raw = keyword({
			aliases: [bare],
			versions: [
				baseVersion({ endingChapter: 9 }),
				version({ id: "version-2", startingChapter: 10, image: versionImage }),
			],
		});

		// Reading chapter 3: the active (base) version has no image, so the
		// alias still shows one instead of nothing.
		const info = resolveKeywordInfo(raw, bare, 3, "en");
		expect(info.image.value?.url).toBe(versionImage.url);
		expect(info.image.source).toBe("version");
	});

	test("prefers the latest version's image among the fallbacks", () => {
		const older = image("older-image");
		const raw = keyword({
			versions: [
				baseVersion({ endingChapter: 4 }),
				version({ id: "version-2", startingChapter: 5, image: older }),
				version({ id: "version-3", startingChapter: 40, image: versionImage }),
			],
		});

		// Chapter 2 reads the base version, which has no image of its own.
		const info = resolveKeywordInfo(raw, null, 2, "en");
		expect(info.image.value?.url).toBe(versionImage.url);
		expect(info.image.source).toBe("version");
	});

	test("the version being read still wins over a later version's image", () => {
		const raw = keyword({
			versions: [
				baseVersion({ image: keywordImage, endingChapter: 9 }),
				version({ id: "version-2", startingChapter: 10, image: versionImage }),
			],
		});

		expect(resolveKeywordInfo(raw, null, 3, "en").image.value?.url).toBe(
			keywordImage.url,
		);
		expect(resolveKeywordInfo(raw, null, 3, "en").image.source).toBe("keyword");
		expect(resolveKeywordInfo(raw, null, 12, "en").image.value?.url).toBe(
			versionImage.url,
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

	test("inherits an unset category while keeping the alias's own image", () => {
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

	test("fall back to the latest version's image when no read version has one", () => {
		const bare = alias({ id: "alias-bare", nameEn: "Bare" });
		const raw = keyword({
			aliases: [bare],
			versions: [
				baseVersion({ endingChapter: 9 }),
				version({ id: "version-2", startingChapter: 10, image: versionImage }),
			],
		});

		const enriched = enrichKeywords([raw], 3, "en");

		for (const id of ["keyword-1", "alias-bare"]) {
			const item = enriched.find((entry) => entry.id === id);
			expect(item?.image?.url).toBe(versionImage.url);
			expect(item?.imageId).toBe(versionImage.id);
		}
	});
});

describe("newest applicable version inheritance", () => {
	test("all aliases inherit the newest overlapping version, with their own fields first", () => {
		const bare = alias({ id: "bare", nameEn: "Bare" });
		const own = alias({
			id: "own",
			nameEn: "Own",
			description: "Alias description",
			overrideStyle: false,
		});
		const raw = keyword({
			aliases: [bare, own],
			versions: [
				baseVersion({ description: "Original", image: keywordImage }),
				version({
					id: "middle",
					startingChapter: 3,
					description: "Middle",
					image: aliasImage,
				}),
				version({
					id: "latest",
					startingChapter: 7,
					description: "Latest",
					image: versionImage,
				}),
			],
		});
		for (const entry of [bare, own]) {
			const info = resolveKeywordInfo(raw, entry, 8, "en");
			expect(info.description.value).toBe(
				entry === own ? "Alias description" : "Latest",
			);
			expect(info.image.value?.url).toBe(versionImage.url);
		}
		const rows = enrichKeywords([raw], 8, "en");
		expect(rows.find((row) => row.id === "bare")?.description).toBe("Latest");
		expect(rows.find((row) => row.id === "own")?.description).toBe(
			"Alias description",
		);
		expect(resolveKeywordInfo(raw, bare, 4, "en").description.value).toBe(
			"Middle",
		);
	});

	test("sparse versions fall back field by field to earlier versions in the selected language", () => {
		const bare = alias({ id: "bare" });
		const raw = keyword({
			aliases: [bare],
			versions: [
				baseVersion({ descriptionEn: "Original", descriptionAr: "الأصل" }),
				version({
					id: "middle",
					startingChapter: 3,
					endingChapter: 6,
					descriptionEn: "Middle",
				}),
				version({ id: "latest", startingChapter: 7 }),
			],
		});
		expect(resolveKeywordInfo(raw, bare, 8, "en").description.value).toBe(
			"Middle",
		);
		expect(resolveKeywordInfo(raw, bare, 8, "ar").description.value).toBe(
			"الأصل",
		);
		expect(
			enrichKeywords([raw], 8, "en").find((row) => row.id === bare.id)
				?.description,
		).toBe("Middle");
	});
});
