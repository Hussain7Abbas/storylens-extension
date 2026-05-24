import { Stack, Loader, Group, Text, type StackProps, Center } from '@mantine/core';
import { ListItemCard } from '../list-item-card';
import { getKeywords } from '@/api/endpoints/keywords.js';
import type { GetKeywords200DataItem, GetKeywordsParams } from '@/api/schemas';
import type { ColoringFormModesType } from './coloring-form';
import { useTranslation } from 'react-i18next';
import {
  INFINITE_SCROLL_PAGE_SIZE,
  useInfiniteScrollList,
} from '@/hooks/use-infinite-scroll-list';

interface ColoringFormProps extends StackProps {
  selectedNovelId: string;
  search: string;
  setKeyword: (keyword: GetKeywords200DataItem) => void;
  setMode: (mode: ColoringFormModesType) => void;
}

export function ColoringCards({
  selectedNovelId,
  search,
  setKeyword,
  setMode,
  ...props
}: ColoringFormProps) {
  const { t } = useTranslation();

  const { items, isLoading, isFetchingNextPage, loadMoreRef } = useInfiniteScrollList<
    GetKeywordsParams,
    GetKeywords200DataItem
  >({
    queryKey: ['keywords', selectedNovelId, { column: 'name', direction: 'asc' }],
    fetchPage: (params, signal) => getKeywords(params, undefined, signal),
    getParams: (page, debouncedSearch) => ({
      pagination: { page, pageSize: INFINITE_SCROLL_PAGE_SIZE },
      sorting: { column: 'name', direction: 'asc' },
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
        {t('home.noKeywords')}
      </Text>
    );
  }

  return (
    <Stack gap="xs" {...props}>
      {items.map((keyword) => (
        <ListItemCard
          key={keyword.id}
          onClick={() => {
            setKeyword(keyword);
            setMode('edit');
          }}
        >
          <Group wrap="nowrap" align="flex-start" gap="xs">
            <Text fw={500} style={{ flex: 1 }}>
              {keyword.name}
            </Text>
            <Group gap="xs" wrap="nowrap">
              <Text size="xs" style={{ color: keyword.category.color }}>
                {keyword.category.name}
              </Text>
              <Text size="xs" style={{ color: keyword.nature.color }}>
                {keyword.nature.name}
              </Text>
            </Group>
          </Group>
          <Text size="sm" c="dimmed">
            {keyword.description}
          </Text>
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
