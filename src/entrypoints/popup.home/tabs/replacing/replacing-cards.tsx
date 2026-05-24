import { Stack, Loader, Group, Text, type StackProps, Center } from '@mantine/core';
import { ListItemCard } from '../list-item-card';
import { getReplacements } from '@/api/endpoints/replacements.js';
import type {
  GetReplacements200DataItem,
  GetReplacementsParams,
} from '@/api/schemas';
import type { ReplacingFormModesType } from './replacing-form';
import { useTranslation } from 'react-i18next';
import {
  INFINITE_SCROLL_PAGE_SIZE,
  useInfiniteScrollList,
} from '@/hooks/use-infinite-scroll-list';

interface ReplacingFormProps extends StackProps {
  selectedNovelId: string;
  search: string;
  setReplacement: (replacement: GetReplacements200DataItem) => void;
  setMode: (mode: ReplacingFormModesType) => void;
}

export function ReplacingCards({
  selectedNovelId,
  search,
  setReplacement,
  setMode,
  ...props
}: ReplacingFormProps) {
  const { t } = useTranslation();

  const { items, isLoading, isFetchingNextPage, loadMoreRef } = useInfiniteScrollList<
    GetReplacementsParams,
    GetReplacements200DataItem
  >({
    queryKey: ['replacements', selectedNovelId, { column: 'from', direction: 'asc' }],
    fetchPage: (params, signal) => getReplacements(params, undefined, signal),
    getParams: (page, debouncedSearch) => ({
      pagination: { page, pageSize: INFINITE_SCROLL_PAGE_SIZE },
      sorting: { column: 'from', direction: 'asc' },
      query: {
        novelId: selectedNovelId,
        search: debouncedSearch || undefined,
      },
    }),
    search,
  });

  if (isLoading) {
    return (
      <Center>
        <Loader />
      </Center>
    );
  }

  if (items.length === 0) {
    return (
      <Text ta="center" c="dimmed">
        {t('replacing.noReplacements')}
      </Text>
    );
  }

  return (
    <Stack gap="xs" {...props}>
      {items.map((replacement) => (
        <ListItemCard
          key={replacement.id}
          onClick={() => {
            setReplacement(replacement);
            setMode('edit');
          }}
        >
          <Group wrap="nowrap" align="flex-start" gap="xs" w="100%">
            <Text fw={500} style={{ flex: 1 }}>
              {replacement.from}
            </Text>
            <Text size="sm" c="dimmed" style={{ flex: 1 }}>
              {replacement.to}
            </Text>
          </Group>
        </ListItemCard>
      ))}
      <div ref={loadMoreRef} />
      {isFetchingNextPage && (
        <Center>
          <Loader size="sm" />
        </Center>
      )}
    </Stack>
  );
}
