import { ActionIcon, Alert, Button, Group, Stack, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import type { KeywordCategory } from '@/types/models';
import {
  useDeleteKeywordCategoriesById,
  usePostKeywordCategories,
  usePutKeywordCategoriesById,
} from '@/api/endpoints/keyword-categories.js';
import type { PostKeywordCategoriesBodyOne } from '@/api/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { IconTrash } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useRefreshContentScript } from '@/hooks/useRefreshContentScript';

export type CategoryFormModesType = 'add' | 'edit' | undefined;

interface CategoryFormProps extends React.HTMLAttributes<HTMLFormElement> {
  mode: CategoryFormModesType;
  category?: KeywordCategory;
  onClose: () => void;
}

export function CategoryForm({
  mode,
  category,
  onClose,
  ...props
}: CategoryFormProps) {
  const { t } = useTranslation();
  const form = useForm<PostKeywordCategoriesBodyOne>({
    initialValues: {
      name: category?.name || '',
      color: category?.color || '#000000',
    },
    validate: {
      name: (value) => (!value ? t('settings.nameRequired') : null),
      color: (value) =>
        !/^#[0-9A-Fa-f]{6}$/.test(value) ? t('settings.invalidColor') : null,
    },
  });

  const queryClient = useQueryClient();
  const refreshContent = useRefreshContentScript();

  const createMutation = usePostKeywordCategories({
    mutation: {
      onSuccess: async () => {
        queryClient.invalidateQueries({ queryKey: ['keyword-categories'] });
        await refreshContent();
        form.reset();
        onClose();
      },
    },
  });

  const updateMutation = usePutKeywordCategoriesById({
    mutation: {
      onSuccess: async () => {
        queryClient.invalidateQueries({ queryKey: ['keyword-categories'] });
        await refreshContent();
        form.reset();
        onClose();
      },
    },
  });

  const deleteMutation = useDeleteKeywordCategoriesById({
    mutation: {
      onSuccess: async () => {
        queryClient.invalidateQueries({ queryKey: ['keyword-categories'] });
        await refreshContent();
        form.reset();
        onClose();
      },
    },
  });

  const handleSubmit = (values: typeof form.values) => {
    if (mode === 'add') {
      createMutation.mutate({ data: values });
      return;
    }

    if (mode === 'edit' && category?.id) {
      updateMutation.mutate({ id: category.id, data: values });
    }
  };

  const handleDelete = () => {
    if (category?.id) {
      deleteMutation.mutate({ id: category.id });
    }
  };

  const isPending =
    createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  return (
    <form onSubmit={form.onSubmit(handleSubmit)} {...props}>
      <Stack gap="xs" p="xs">
        <TextInput
          label={t('settings.name')}
          {...form.getInputProps('name')}
          required
        />

        <TextInput
          label={t('settings.color')}
          placeholder="#FF0000"
          {...form.getInputProps('color')}
          required
        />

        {(createMutation.isError || updateMutation.isError) && (
          <Alert color="red">{t('settings.update')}</Alert>
        )}

        <Group justify="space-between" mt="md">
          {mode === 'edit' ? (
            <ActionIcon
              variant="transparent"
              color="red"
              size="lg"
              onClick={handleDelete}
            >
              <IconTrash />
            </ActionIcon>
          ) : (
            <span />
          )}
          <Group>
            <Button variant="outline" onClick={onClose}>
              {t('_.cancel')}
            </Button>
            <Button type="submit" loading={isPending}>
              {t('_.save')}
            </Button>
          </Group>
        </Group>
      </Stack>
    </form>
  );
}
