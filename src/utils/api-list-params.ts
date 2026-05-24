export const DEFAULT_LIST_PAGINATION = {
  page: 1,
  pageSize: 200,
} as const;

export const NOVEL_LIST_SORTING = {
  column: 'name',
  direction: 'asc',
} as const;

export const KEYWORD_LIST_SORTING = {
  column: 'name',
  direction: 'asc',
} as const;

export const REPLACEMENT_LIST_SORTING = {
  column: 'from',
  direction: 'asc',
} as const;

export function withListQueryParams(
  params: Record<string, unknown> = {},
  sorting: { column: string; direction: string } = NOVEL_LIST_SORTING,
): Record<string, unknown> {
  return {
    pagination: DEFAULT_LIST_PAGINATION,
    sorting,
    ...params,
  };
}
