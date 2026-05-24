import { Container, Tabs } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { GeneralTab } from './general-tab';
import { CategoryTab } from './category-tab';
import { NatureTab } from './nature-tab';

export function SettingsPage() {
  const { t } = useTranslation();

  return (
    <Container p="md">
      <Tabs defaultValue="general" variant="outline">
        <Tabs.List grow>
          <Tabs.Tab value="general">{t('tabs.general')}</Tabs.Tab>
          <Tabs.Tab value="category">{t('tabs.category')}</Tabs.Tab>
          <Tabs.Tab value="nature">{t('tabs.nature')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="general">
          <GeneralTab />
        </Tabs.Panel>
        <Tabs.Panel value="category">
          <CategoryTab />
        </Tabs.Panel>
        <Tabs.Panel value="nature">
          <NatureTab />
        </Tabs.Panel>
      </Tabs>
    </Container>
  );
}
