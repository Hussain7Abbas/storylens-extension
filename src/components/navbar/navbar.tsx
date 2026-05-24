import {
  ActionIcon,
  Box,
  Group,
  Image,
  Title,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import {
  IconChevronLeft,
  IconChevronRight,
  IconLogin,
  IconMoon,
  IconRefresh,
  IconSettings,
  IconSun,
} from '@tabler/icons-react';
import cx from 'clsx';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import icon from '@/assets/icon.png';
import { useRoutes } from '@/hooks/useRoutes';
import toast from 'react-hot-toast';
import { refreshContentScript } from '@/utils/refresh-content-script';
import classes from './navbar.module.css';

export function Navbar() {
  const isLoggedIn = true;
  const { t, i18n } = useTranslation();
  const dir = i18n.language === 'ar' ? 'rtl' : 'ltr';

  return (
    <Group
      justify="space-between"
      w="100%"
      px="md"
      py="xs"
      style={{ borderBottom: '1px solid #e5e7eb' }}
      wrap="nowrap"
    >
      <Group wrap="nowrap">
        <Image src={icon} alt="Logo" width={32} height={32} />
        <Title order={4} textWrap="nowrap">
          {t('extName')}
        </Title>
      </Group>
      {!isLoggedIn && <LoginButton t={t} />}
      {isLoggedIn && (
        <Group>
          <RefreshContentButton t={t} />
          <ToggleColorScheme t={t} />
          <ActionsMenu t={t} dir={dir} />
        </Group>
      )}
    </Group>
  );
}

export function LoginButton({ t }: { t: TFunction }) {
  return (
    <Tooltip label={t('navbar.login')} withArrow>
      <Box>
        <ActionIcon variant="transparent">
          <IconLogin />
        </ActionIcon>
      </Box>
    </Tooltip>
  );
}

function RefreshContentButton({ t }: { t: TFunction }) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const refreshed = await refreshContentScript();
      if (!refreshed) {
        toast.error(t('navbar.refreshContentFailed'));
      }
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Tooltip label={t('navbar.refreshContent')} withArrow>
      <ActionIcon
        variant="transparent"
        size="lg"
        aria-label={t('navbar.refreshContent')}
        loading={refreshing}
        onClick={() => {
          void handleRefresh();
        }}
      >
        <IconRefresh stroke={1.5} />
      </ActionIcon>
    </Tooltip>
  );
}

export function ToggleColorScheme({ t }: { t: TFunction }) {
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme('light', {
    getInitialValueInEffect: true,
  });

  return (
    <Tooltip label={t('navbar.toggleColorScheme')} withArrow>
      <ActionIcon
        onClick={() =>
          setColorScheme(computedColorScheme === 'light' ? 'dark' : 'light')
        }
        variant="transparent"
        size="lg"
        aria-label="Toggle color scheme"
      >
        <IconSun className={cx(classes.icon, classes.light)} stroke={1.5} />
        <IconMoon className={cx(classes.icon, classes.dark)} stroke={1.5} />
      </ActionIcon>
    </Tooltip>
  );
}

function ActionsMenu({ t, dir }: { t: TFunction; dir: 'rtl' | 'ltr' }) {
  const { go, back, routes } = useRoutes();

  return routes.length > 1 ? (
    <ActionIcon variant="transparent" onClick={() => back()}>
      {dir === 'rtl' ? <IconChevronLeft /> : <IconChevronRight />}
    </ActionIcon>
  ) : (
    <Tooltip label={t('navbar.settings')} withArrow>
      <ActionIcon variant="transparent" onClick={() => go('settings')}>
        <IconSettings />
      </ActionIcon>
    </Tooltip>
    // FIXME: use this later after applying auth
    //    <Menu shadow="md" width={200}>
    //    <Menu.Target>
    //      <ActionIcon variant="transparent">
    //        <IconDotsVertical />
    //      </ActionIcon>
    //    </Menu.Target>

    //    <Menu.Dropdown>
    //      <Menu.Label>{t('navbar.user')}</Menu.Label>
    //      <Menu.Item leftSection={<IconUser size={14} />} onClick={() => go('profile')}>
    //        {t('navbar.profile')}
    //      </Menu.Item>
    //      <Menu.Item
    //        leftSection={<IconSettings size={14} />}
    //        onClick={() => go('settings')}
    //      >
    //        {t('navbar.settings')}
    //      </Menu.Item>

    //      <Menu.Divider />
    //      <Menu.Label>{t('navbar.application')}</Menu.Label>

    //      <Menu.Item leftSection={<IconDownload size={14} />}>
    //        {t('navbar.import')}
    //      </Menu.Item>
    //      <Menu.Item leftSection={<IconUpload size={14} />}>
    //        {t('navbar.export')}
    //      </Menu.Item>
    //      <Menu.Item color="red" leftSection={<IconUpload size={14} />}>
    //        {t('navbar.logout')}
    //      </Menu.Item>
    //    </Menu.Dropdown>
    //  </Menu>
  );
}
