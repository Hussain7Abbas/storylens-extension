'use client';

import { useSetState } from '@mantine/hooks';
import type { DataTableSortStatus } from 'mantine-datatable';

export interface Sorting {
  column: string;
  direction: 'asc' | 'desc';
}

interface useSortingParams {
  sorting?: Sorting;
}

export function useSorting({ sorting: defaultSorting }: useSortingParams = {}) {
  const [dtSorting, setDtSorting] = useSetState<DataTableSortStatus>(
    defaultSorting
      ? {
          columnAccessor: defaultSorting.column,
          direction: defaultSorting.direction,
          sortKey: defaultSorting.column,
        }
      : {
          columnAccessor: 'createdAt',
          direction: 'desc',
          sortKey: 'createdAt',
        },
  );

  const [sorting, setSorting] = useSetState<Sorting>({
    column: 'createdAt',
    direction: 'desc',
  });

  function handleSetDtSorting(newSorting: DataTableSortStatus) {
    setSorting(() => {
      return {
        column: newSorting.sortKey || newSorting.columnAccessor,
        direction: newSorting.direction,
      };
    });
    setDtSorting(() => newSorting);
  }

  return {
    sorting,
    setSorting,
    dtSorting,
    setDtSorting: handleSetDtSorting,
  };
}
