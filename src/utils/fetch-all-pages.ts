/** One page of a paginated reader API list. */
export type ListPage<T> = { data: T[]; total: number };

export type FetchPageOptions = { signal?: AbortSignal; timeout: number };

export const FETCH_ALL_PAGE_SIZE = 500;

/**
 * Requests pages of `pageSize` until `total` rows arrived or a page comes back
 * empty, passing the abort signal and a per-request timeout to each request.
 * Downloads and pulls use it so large novels and catalogues are never cut at
 * the first page.
 */
export async function fetchAllPages<T>(
	fetchPage: (
		pagination: { page: number; pageSize: number },
		options: FetchPageOptions,
	) => Promise<ListPage<T>>,
	{
		signal,
		timeout = 20_000,
		pageSize = FETCH_ALL_PAGE_SIZE,
	}: { signal?: AbortSignal; timeout?: number; pageSize?: number } = {},
): Promise<T[]> {
	const rows: T[] = [];
	for (let page = 1; ; page++) {
		signal?.throwIfAborted();
		const result = await fetchPage({ page, pageSize }, { signal, timeout });
		rows.push(...result.data);
		if (result.data.length === 0 || rows.length >= result.total) return rows;
	}
}
