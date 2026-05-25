import { getNovels } from "@/api/generated/endpoints/novels.js";
import type { GetNovels200DataItem } from "@/api/generated/schemas";
import { bulkPutCatalogNovels } from "@/lib/offline/db";
import { isOnline } from "@/lib/offline/online-status";
import { withListQueryParams } from "@/utils/api-list-params";

const CATALOG_PAGE_SIZE = 500;

export async function refreshNovelsCatalog(): Promise<GetNovels200DataItem[]> {
	if (!isOnline()) {
		throw new Error("Cannot refresh novels catalog while offline");
	}

	const response = await getNovels(
		withListQueryParams({
			pagination: { page: 1, pageSize: CATALOG_PAGE_SIZE },
			sorting: { column: "name", direction: "asc" },
		}),
	);

	const novels = response.data.data;
	await bulkPutCatalogNovels(novels);
	return novels;
}
