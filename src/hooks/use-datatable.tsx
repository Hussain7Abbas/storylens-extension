'use client';

import { useSetState } from '@mantine/hooks';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from '@/lib/utils/constants';
import type { DataTableProps } from 'mantine-datatable';
import { useTranslation } from 'react-i18next';
import { useSorting } from './use-sorting';
import type { QueryObserverResult } from '@tanstack/react-query';
import type { TFunction } from 'i18next';

interface getTablePropsParams {
  query?: QueryObserverResult<{ total: number; data: unknown[] }, unknown>;
  isPagination?: boolean;
  isSorting?: boolean;
}

interface Pagination {
  page: number;
  pageSize: number;
}

interface Sorting {
  column: string;
  direction: 'asc' | 'desc';
}

interface useDataTableParams {
  pagination?: Pagination;
  sorting?: Sorting;
}

export function useDataTable({
  pagination: defaultPagination,
  sorting: defaultSorting,
}: useDataTableParams = {}) {
  // TODO: fix this workarount for next-intl v4
  let t: TFunction;

  try {
    // biome-ignore lint/correctness/useHookAtTopLevel: false positive
    t = useTranslation().t;
  } catch (_) {
    // Fallback when NextIntlClientProvider context is not found
    // @ts-expect-error
    t = (key: string): string => {
      const fallbacks: Record<string, string> = {
        'dataTable.noRecords': 'No records found',
        'dataTable.recordsPerPageLabel': 'Records per page',
      };
      return fallbacks[key] || key;
    };
  }

  const [pagination, setPagination] = useSetState<Pagination>(
    defaultPagination || {
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    },
  );

  const { sorting, setSorting, dtSorting, setDtSorting } = useSorting({
    sorting: defaultSorting,
  });

  function getTableProps({
    query,
    isPagination = true,
    isSorting = true,
  }: getTablePropsParams) {
    let props: DataTableProps = {
      noRecordsText: t('dataTable.noRecords'),

      borderRadius: 'md',
      withRowBorders: true,
      withTableBorder: true,
      withColumnBorders: true,
      fetching: query?.isLoading,
      minHeight: query?.data?.data?.length ? undefined : 200,
      columns: [],
      records: [],
    };

    if (isPagination) {
      props = {
        ...props,
        totalRecords: query?.data?.total ?? 0,
        recordsPerPageOptions: PAGE_SIZE_OPTIONS,
        page: pagination.page,
        onPageChange: (page) => setPagination({ page }),
        recordsPerPage: pagination.pageSize,
        onRecordsPerPageChange: (pageSize) => setPagination({ pageSize }),
        recordsPerPageLabel: t('dataTable.recordsPerPageLabel'),
      };
    }

    if (isSorting) {
      props = {
        ...props,
        sortStatus: dtSorting,
        onSortStatusChange: setDtSorting,
      };
    }

    return props;
  }

  return {
    pagination,
    setPagination,
    sorting,
    setSorting,
    getTableProps,
  };
}
