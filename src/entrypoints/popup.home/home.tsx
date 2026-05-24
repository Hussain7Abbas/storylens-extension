import {
  ActionIcon,
  Container,
  Group,
  Menu,
  Select,
  Skeleton,
  Stack,
  Tabs,
  Text,
} from '@mantine/core';
import { ColoringTab, ReplacingTab } from './tabs';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useGetNovels } from '@/api/endpoints/novels.js';
import type { Novel } from '@/types/models';
import { NovelForm, type novelFormModes } from './novelForm';
import { useDetectedNovel } from './use-detected-novel';
import {
  IconCrosshair,
  IconDotsVertical,
  IconEdit,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';
import type { currentNovelMeta } from '@/types';
import type { TFunction } from 'i18next';

export function HomePage() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<novelFormModes>();

  // API hooks
  const {
    data: novelsData,
    isLoading: novelsLoading,
    refetch: refetchNovels,
  } = useGetNovels<{
    data: { data: Novel[] };
  }>({
    pagination: { page: 1, pageSize: 100 },
    sorting: { column: 'name', direction: 'asc' },
  });

  const { selectedNovel, setSelectedNovel, currentTabNovel } = useDetectedNovel(
    novelsData?.data?.data,
  );

  return (
    <Container p="md">
      {mode !== undefined ? (
        <NovelForm
          refetchNovels={refetchNovels}
          selectedNovel={selectedNovel}
          mode={mode}
          onClose={() => {
            setMode(undefined);
          }}
        />
      ) : (
        <Stack gap={0}>
          {novelsLoading ? (
            <Skeleton height={40} animate />
          ) : (
            <Group gap="xs" align="end">
              <Select
                label={t('coloring.novel')}
                placeholder={t('home.selectNovelPlaceholder')}
                allowDeselect={false}
                data={novelsData?.data?.data?.map((novel: Novel) => ({
                  value: novel.id,
                  label: novel.name,
                }))}
                value={selectedNovel?.id}
                onChange={(value) =>
                  setSelectedNovel(
                    novelsData?.data?.data?.find(
                      (novel: Novel) => novel.id === value,
                    ),
                  )
                }
                required
                searchable
              />
              <Text flex={1} ta="center">
                {currentTabNovel?.chapter}
              </Text>
              <NovelMenu
                currentTabNovel={currentTabNovel}
                setSelectedNovel={setSelectedNovel}
                setMode={setMode}
                t={t}
              />
            </Group>
          )}

          {selectedNovel?.id && (
            <Tabs defaultValue="coloring" variant="outline">
              <Stack
                gap="xs"
                pos="sticky"
                top={0}
                style={{
                  zIndex: 2,
                  ['--popup-tabs-sticky-height' as string]:
                    'calc(var(--mantine-spacing-xs) + 36px)',
                }}
                pt="xs"
                styles={{
                  root: {
                    backgroundColor: 'var(--mantine-color-body)',
                  },
                }}
              >
                <Tabs.List grow>
                  <Tabs.Tab value="coloring">{t('tabs.coloring')}</Tabs.Tab>
                  <Tabs.Tab value="replacing">{t('tabs.replacing')}</Tabs.Tab>
                </Tabs.List>
              </Stack>
              <Tabs.Panel value="coloring">
                <ColoringTab selectedNovelId={selectedNovel?.id} />
              </Tabs.Panel>
              <Tabs.Panel value="replacing">
                <ReplacingTab selectedNovelId={selectedNovel?.id} />
              </Tabs.Panel>
            </Tabs>
          )}
        </Stack>
      )}
    </Container>
  );
}

function NovelMenu({
  currentTabNovel,
  setSelectedNovel,
  setMode,
  t,
}: {
  currentTabNovel: currentNovelMeta | undefined;
  setSelectedNovel: (novel: Partial<Novel> | undefined) => void;
  setMode: (mode: novelFormModes) => void;
  t: TFunction;
}) {
  return (
    <Menu shadow="md" width={200}>
      <Menu.Target>
        <ActionIcon variant="transparent">
          <IconDotsVertical />
        </ActionIcon>
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Item
          leftSection={<IconPlus size={14} color="green" />}
          onClick={() => {
            setSelectedNovel(
              currentTabNovel
                ? {
                    slugs: [currentTabNovel.novelSlug],
                  }
                : undefined,
            );
            setMode('add');
          }}
        >
          {t('novels.add')}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconEdit size={14} color="blue" />}
          onClick={() => {
            setMode('edit');
          }}
        >
          {t('novels.edit')}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconTrash size={14} color="red" />}
          onClick={() => {
            setMode('delete');
          }}
        >
          {t('novels.delete')}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconCrosshair size={14} color="gray" />}
          onClick={() => {
            toast.success(t('novels.comingSoon'));
          }}
        >
          {t('novels.applyKeywordsAndReplacements')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
