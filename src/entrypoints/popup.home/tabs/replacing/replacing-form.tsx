import { Stack, TextInput, Alert, Button, Group, ActionIcon } from '@mantine/core';
import { useForm } from '@mantine/form';
import {
  usePostReplacements,
  useDeleteReplacementsById,
  usePutReplacementsById,
} from '@/api/endpoints/replacements.js';
import { useTranslation } from 'react-i18next';
import type {
  GetReplacements200DataItem,
  PostReplacementsBodyOne,
} from '@/api/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { IconTrash } from '@tabler/icons-react';
import { useRefreshContentScript } from '@/hooks/useRefreshContentScript';

export type ReplacingFormModesType = 'add' | 'edit' | undefined;
interface ReplacingFormProps extends React.HTMLAttributes<HTMLFormElement> {
  mode: ReplacingFormModesType;
  selectedNovelId: string | undefined;
  replacement?: GetReplacements200DataItem;
  onClose: () => void;
}

export function ReplacingForm({
  mode,
  selectedNovelId,
  replacement,
  onClose,
  ...props
}: ReplacingFormProps) {
  const { t } = useTranslation();
  const form = useForm<PostReplacementsBodyOne>({
    initialValues: {
      novelId: replacement?.novelId || '',
      from: replacement?.from || '',
      to: replacement?.to || '',
    },
    validate: {
      from: (value) => (!value ? t('replacing.fromRequired') : null),
      to: (value) => (!value ? t('replacing.toRequired') : null),
    },
  });

  const queryClient = useQueryClient();
  const refreshContent = useRefreshContentScript();

  const createKeywordMutation = usePostReplacements({
    mutation: {
      onSuccess: async () => {
        queryClient.invalidateQueries({ queryKey: ['replacements'] });
        await refreshContent();
        form.reset();
        onClose();
      },
    },
  });

  const updateReplacementMutation = usePutReplacementsById({
    mutation: {
      onSuccess: async () => {
        queryClient.invalidateQueries({ queryKey: ['replacements'] });
        await refreshContent();
        form.reset();
        onClose();
      },
    },
  });

  const deleteReplacementMutation = useDeleteReplacementsById({
    mutation: {
      onSuccess: async () => {
        queryClient.invalidateQueries({ queryKey: ['replacements'] });
        await refreshContent();
        form.reset();
        onClose();
      },
    },
  });

  const handleSubmit = (values: typeof form.values) => {
    if (!selectedNovelId) {
      form.setFieldError('novel', t('home.selectNovelFirst'));
      return;
    }

    if (mode === 'add') {
      createKeywordMutation.mutate({
        data: {
          novelId: selectedNovelId,
          from: values.from,
          to: values.to,
        },
      });
    } else if (mode === 'edit' && replacement?.id) {
      updateReplacementMutation.mutate({
        id: replacement.id,
        data: values,
      });
    }
  };

  const handleDelete = () => {
    if (replacement?.id) {
      deleteReplacementMutation.mutate({ id: replacement.id });
    }
  };

  return (
    <form onSubmit={form.onSubmit(handleSubmit)} {...props}>
      <Stack gap="xs" p="xs">
        <TextInput
          label={t('replacing.from')}
          {...form.getInputProps('from')}
          required
        />

        <TextInput label={t('replacing.to')} {...form.getInputProps('to')} required />

        {createKeywordMutation.isError && (
          <Alert color="red">
            {t('replacing.createFailed')}: {createKeywordMutation.error?.message}
          </Alert>
        )}

        <Group justify="space-between" mt="md">
          <ActionIcon
            variant="transparent"
            color="red"
            size="lg"
            onClick={() => handleDelete()}
          >
            <IconTrash />
          </ActionIcon>
          <Group>
            <Button variant="outline" onClick={onClose}>
              {t('_.cancel')}
            </Button>
            <Button type="submit" loading={createKeywordMutation.isPending}>
              {t('_.save')}
            </Button>
          </Group>
        </Group>
      </Stack>
    </form>
  );
}
