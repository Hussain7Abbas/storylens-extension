import {
	ActionIcon,
	Box,
	Group,
	Image,
	Title,
	Tooltip,
	useComputedColorScheme,
	useMantineColorScheme,
} from "@mantine/core";
import {
	IconChevronLeft,
	IconChevronRight,
	IconCloudUpload,
	IconLogin,
	IconMoon,
	IconRefresh,
	IconSettings,
	IconSun,
} from "@tabler/icons-react";
import cx from "clsx";
import type { TFunction } from "i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import icon from "@/assets/icon.png";
import { sendMessage } from "@/entrypoints/background/messaging";
import { useRoutes } from "@/hooks/useRoutes";
import { useOnlineStatus, usePendingSyncCount } from "@/lib/offline/hooks";
import { refreshContentScript } from "@/utils/refresh-content-script";
import classes from "./navbar.module.css";

export function Navbar() {
	const isLoggedIn = true;
	const { t, i18n } = useTranslation();
	const dir = i18n.language === "ar" ? "rtl" : "ltr";
	const online = useOnlineStatus();
	const pendingCount = usePendingSyncCount();

	return (
		<Group
			justify="space-between"
			w="100%"
			px="md"
			py="xs"
			style={{ borderBottom: "1px solid #e5e7eb" }}
			wrap="nowrap"
		>
			<Group wrap="nowrap">
				<Image src={icon} alt="Logo" width={32} height={32} />
				<Title order={4} textWrap="nowrap">
					{t("extName")}
				</Title>
			</Group>
			{!isLoggedIn && <LoginButton t={t} />}
			{isLoggedIn && (
				<Group>
					{!online && pendingCount > 0 && (
						<SyncButton t={t} pendingCount={pendingCount} online={online} />
					)}
					<RefreshContentButton t={t} />
					<ToggleColorScheme t={t} />
					<ActionsMenu t={t} dir={dir} />
				</Group>
			)}
		</Group>
	);
}

function SyncButton({
	t,
	pendingCount,
	online,
}: {
	t: TFunction;
	pendingCount: number;
	online: boolean;
}) {
	const [syncing, setSyncing] = useState(false);
	const queryClient = useQueryClient();

	const handleSync = async () => {
		if (!online) {
			toast.error(t("offline.syncRequiresOnline"));
			return;
		}

		setSyncing(true);
		try {
			const result = await sendMessage("triggerFullSync");
			await queryClient.invalidateQueries({ queryKey: ["offline"] });
			toast.success(
				t("offline.syncSuccess", {
					pushed: result.pushed,
					pulled: result.pulled,
				}),
			);
		} catch {
			toast.error(t("offline.syncFailed"));
		} finally {
			setSyncing(false);
		}
	};

	return (
		<Tooltip
			label={
				pendingCount > 0
					? t("offline.syncPending", { count: pendingCount })
					: t("offline.syncNow")
			}
			withArrow
		>
			<ActionIcon
				variant="transparent"
				size="lg"
				aria-label={t("offline.syncNow")}
				loading={syncing}
				onClick={() => {
					void handleSync();
				}}
			>
				<IconCloudUpload stroke={1.5} />
			</ActionIcon>
		</Tooltip>
	);
}

export function LoginButton({ t }: { t: TFunction }) {
	return (
		<Tooltip label={t("navbar.login")} withArrow>
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
				toast.error(t("navbar.refreshContentFailed"));
			}
		} finally {
			setRefreshing(false);
		}
	};

	return (
		<Tooltip label={t("navbar.refreshContent")} withArrow>
			<ActionIcon
				variant="transparent"
				size="lg"
				aria-label={t("navbar.refreshContent")}
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
	const computedColorScheme = useComputedColorScheme("light", {
		getInitialValueInEffect: true,
	});

	return (
		<Tooltip label={t("navbar.toggleColorScheme")} withArrow>
			<ActionIcon
				onClick={() =>
					setColorScheme(computedColorScheme === "light" ? "dark" : "light")
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

function ActionsMenu({ t, dir }: { t: TFunction; dir: "rtl" | "ltr" }) {
	const { go, back, routes } = useRoutes();

	return routes.length > 1 ? (
		<ActionIcon variant="transparent" onClick={() => back()}>
			{dir === "rtl" ? <IconChevronLeft /> : <IconChevronRight />}
		</ActionIcon>
	) : (
		<Tooltip label={t("navbar.settings")} withArrow>
			<ActionIcon variant="transparent" onClick={() => go("settings")}>
				<IconSettings />
			</ActionIcon>
		</Tooltip>
	);
}
