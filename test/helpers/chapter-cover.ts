import type { NovelContentData } from "../../src/types/content-data";
import { alias, baseVersion, image, keyword, version } from "./keywords";

export function coverChapter(): NovelContentData {
	return {
		novel: {
			id: "novel-1",
			nameEn: "The Lantern Archive",
			nameAr: null,
			descriptionEn: null,
			descriptionAr: null,
			context: "Fantasy city and ancient archives.",
			slugs: ["lantern"],
			imageId: null,
			createdById: null,
			createdAt: "2026-01-01",
			updatedAt: "2026-01-01",
		},
		language: "en",
		chapterNumber: 12,
		replacements: [],
		biases: [],
		keywords: [
			keyword({
				nameEn: "Mira",
				versions: [
					baseVersion({
						description: "An archivist.",
						image: image("young-mira"),
						endingChapter: 9,
					}),
					version({
						id: "later",
						startingChapter: 10,
						description: "Wears silver armor.",
						image: image("armored-mira"),
					}),
				],
				aliases: [
					alias({
						id: "alias",
						nameEn: "Guardian",
						description: "A masked guardian.",
						image: image("guardian"),
						overrideStyle: false,
					}),
				],
			}),
			keyword({
				id: "absent",
				nameEn: "Absent",
				versions: [baseVersion({ description: "Must not appear." })],
			}),
		],
	};
}
