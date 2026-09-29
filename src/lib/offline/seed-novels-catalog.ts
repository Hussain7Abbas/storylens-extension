import { getNovels } from "@/api/generated/endpoints/novels.js";
import type { GetNovels200DataItem } from "@/api/generated/schemas";
import { bulkPutCatalogNovels } from "@/lib/offline/db";
import { isOnline } from "@/lib/offline/online-status";
import { withListQueryParams } from "@/utils/api-list-params";
import { LANGUAGES } from "@/utils/translation";

const CATALOG_PAGE_SIZE = 500;

export async function refreshNovelsCatalog(): Promise<GetNovels200DataItem[]> {
	if (!isOnline()) {
		throw new Error("Cannot refresh novels catalog while offline");
	}

	// The API lists novels named in one language per request; the catalogue keeps
	// both so slug detection and a language switch work offline. Screens filter by language.
	const responses = await Promise.all(
		LANGUAGES.map((language) =>
			getNovels(
				withListQueryParams({
					pagination: { page: 1, pageSize: CATALOG_PAGE_SIZE },
					sorting: { column: "name", direction: "asc" },
				}),
				{ headers: { "Accept-Language": language } },
			),
		),
	);

	const byId = new Map(
		responses
			.flatMap((response) => response.data.data)
			.map((novel) => [novel.id, novel]),
	);
	const novels = [...byId.values()];
	await bulkPutCatalogNovels(novels);
	return novels;
}
