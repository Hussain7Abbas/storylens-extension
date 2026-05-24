import type { KeywordNature } from '@/types/models';
import { Button, Stack } from '@mantine/core';
import { useGetKeywordNatures } from '@/api/endpoints/keyword-natures.js';
import { DataTable } from 'mantine-datatable';
import { useTranslation } from 'react-i18next';
import { useDataTable } from '@/hooks/use-datatable';
import type { QueryObserverResult } from '@tanstack/react-query';
import { useSetState } from '@mantine/hooks';
import { useEffect, useState } from 'react';
import { SearchInput } from '@/components/search-input';
import { NatureForm, type NatureFormModesType } from './nature-form';

export function NatureTab() {
  const { t } = useTranslation();
  const [formMode, setFormMode] = useState<NatureFormModesType>(undefined);
  const [nature, setNature] = useState<KeywordNature | undefined>();

  const [query, setQuery] = useSetState<{ search: string }>({
    search: '',
  });

  const { pagination, sorting, setPagination, getTableProps } = useDataTable();
  useEffect(() => setPagination({ page: 1 }), [query, setPagination]);

  const natures = useGetKeywordNatures<{
    data: { data: KeywordNature[]; total: number };
  }>({
    pagination,
    sorting,
  });

  const tableProps = getTableProps({
    query: natures as unknown as QueryObserverResult<
      { total: number; data: KeywordNature[] },
      unknown
    >,
  });

  if (formMode) {
    return (
      <NatureForm
        mode={formMode}
        nature={nature}
        onClose={() => {
          setFormMode(undefined);
          setNature(undefined);
        }}
      />
    );
  }

  return (
    <Stack p="md" gap="xs">
      <Button
        variant="light"
        color="green.7"
        onClick={() => {
          setNature(undefined);
          setFormMode('add');
        }}
      >
        {t('settings.addNature')}
      </Button>

      <SearchInput
        value={query.search || ''}
        onChange={(value) => setQuery({ search: value as string })}
        variant="default"
      />

      <DataTable
        {...tableProps}
        noRecordsText={t('dataTable.noRecords')}
        onRowClick={({ record }) => {
          setNature(record as KeywordNature);
          setFormMode('edit');
        }}
        columns={[
          { accessor: 'name', title: t('settings.name') },
          { accessor: 'color', title: t('settings.color') },
        ]}
      />
    </Stack>
  );
}
