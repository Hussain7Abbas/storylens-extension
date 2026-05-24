import { Button, Fieldset, Group, Stack, Text } from '@mantine/core';
import { useAtom } from 'jotai';
import { localeAtom } from '@/store/locale';
import { useTranslation } from 'react-i18next';
import { NodeSelector } from '../../components/node-selector/node-selector';

export function GeneralTab() {
  const { t } = useTranslation();
  const [locale, setLocale] = useAtom(localeAtom);
  function handleChangeLanguage() {
    setLocale(locale === 'ar' ? 'en' : 'ar');
  }
  return (
    <Stack gap="xs" p="md">
      <Group>
        <Text>{t('settings.language')}:</Text>
        <Button onClick={handleChangeLanguage}>
          {locale === 'ar'
            ? t('settings.languageEnglish')
            : t('settings.languageArabic')}
        </Button>
      </Group>
      <Fieldset legend={t('nodeSelector.nodeSelector')}>
        <NodeSelector />
      </Fieldset>
    </Stack>
  );
}
