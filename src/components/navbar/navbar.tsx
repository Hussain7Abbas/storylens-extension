import {
	ActionIcon,
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
	IconLanguage,
	IconMoon,
	IconRefresh,
	IconSettings,
	IconSun,
	IconUser,
} from "@tabler/icons-react";
import cx from "clsx";
import type { TFunction } from "i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import icon from "@/assets/icon.png";
import { sendMessage } from "@/entrypoints/background/messaging";
import { useRoutes } from "@/hooks/useRoutes";
import { userRoleAtom } from "@/lib/auth";
import { useOnlineStatus, usePendingSyncCount } from "@/lib/offline/hooks";
import { localeAtom } from "@/store/locale";
import { refreshContentScript } from "@/utils/refresh-content-script";
import classes from "./navbar.module.css";

export function Navbar() {
	const { t, i18n } = useTranslation();
	const dir = i18n.language === "ar" ? "rtl" : "ltr";
	const online = useOnlineStatus();
	const pendingCount = usePendingSyncCount();
	const role = useAtomValue(userRoleAtom);
	const isAdmin = role === "admin";
	const { routes, current } = useRoutes();
	const canGoBack = routes.length > 1;
	const isOnProfile = current === "profile";

	const pinnedAction = canGoBack ? (
		<BackButton t={t} dir={dir} />
	) : isAdmin ? (
		<SettingsButton t={t} />
	) : null;

	return (
		<Group
			justify="space-between"
			w="100%"
			px="md"
			py="xs"
			className={classes.root}
			wrap="nowrap"
			dir={dir}
		>
			<Group wrap="nowrap" className={classes.brand}>
				<Image src={icon} alt="Logo" width={32} height={32} />
				<Title order={4} textWrap="nowrap">
					{t("extName")}
				</Title>
			</Group>
			<NavbarActionsScroll dir={dir} pinnedAction={pinnedAction}>
				{!online && pendingCount > 0 && (
					<SyncButton t={t} pendingCount={pendingCount} online={online} />
				)}
				<RefreshContentButton t={t} />
				<ToggleColorScheme t={t} />
				{!isAdmin && <ToggleLanguage t={t} />}
				{!isOnProfile && <ProfileButton t={t} />}
			</NavbarActionsScroll>
		</Group>
	);
}

function NavbarActionsScroll({
	children,
	dir,
	pinnedAction,
}: {
	children: ReactNode;
	dir: "rtl" | "ltr";
	pinnedAction?: ReactNode;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [fadeStart, setFadeStart] = useState(false);
	const [fadeEnd, setFadeEnd] = useState(false);

	const updateFade = useCallback(() => {
		const element = scrollRef.current;
		if (!element) {
			return;
		}

		const { scrollWidth, clientWidth } = element;
		const overflow = scrollWidth > clientWidth + 1;
		const scrollOffset = Math.abs(element.scrollLeft);
		const maxScroll = scrollWidth - clientWidth;

		setFadeStart(overflow && scrollOffset > 1);
		setFadeEnd(overflow && scrollOffset < maxScroll - 1);
	}, []);

	useEffect(() => {
		const element = scrollRef.current;
		if (!element) {
			return;
		}

		updateFade();

		const observer = new ResizeObserver(() => {
			updateFade();
		});

		observer.observe(element);
		element.addEventListener("scroll", updateFade, { passive: true });

		return () => {
			observer.disconnect();
			element.removeEventListener("scroll", updateFade);
		};
	}, [updateFade, dir, children, pinnedAction]);

	return (
		<Group
			wrap="nowrap"
			gap={4}
			justify="flex-end"
			className={classes.actionsWrapper}
			dir={dir}
		>
			<div className={classes.actionsScrollRegion}>
				<div
					className={classes.actionsFadeStart}
					data-visible={fadeStart}
					aria-hidden
				/>
				<div ref={scrollRef} className={classes.actionsScroll} dir={dir}>
					<Group wrap="nowrap" gap={4} className={classes.actionsInner}>
						{children}
					</Group>
				</div>
				<div
					className={classes.actionsFadeEnd}
					data-visible={fadeEnd}
					aria-hidden
				/>
			</div>
			{pinnedAction}
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

function ProfileButton({ t }: { t: TFunction }) {
	const { go } = useRoutes();

	return (
		<Tooltip label={t("navbar.profile")} withArrow>
			<ActionIcon variant="transparent" size="lg" onClick={() => go("profile")}>
				<IconUser stroke={1.5} />
			</ActionIcon>
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

function ToggleLanguage({ t }: { t: TFunction }) {
	const [locale, setLocale] = useAtom(localeAtom);

	const toggleLanguage = () => {
		setLocale(locale === "ar" ? "en" : "ar");
	};

	return (
		<Tooltip
			label={
				locale === "ar"
					? t("settings.languageEnglish")
					: t("settings.languageArabic")
			}
			withArrow
		>
			<ActionIcon
				variant="transparent"
				size="lg"
				aria-label={t("navbar.switchLanguage")}
				onClick={toggleLanguage}
			>
				<IconLanguage stroke={1.5} />
			</ActionIcon>
		</Tooltip>
	);
}

function BackButton({ t, dir }: { t: TFunction; dir: "rtl" | "ltr" }) {
	const { back } = useRoutes();

	return (
		<Tooltip label={t("_.back")} withArrow>
			<ActionIcon
				variant="transparent"
				size="lg"
				aria-label={t("_.back")}
				onClick={() => back()}
			>
				{dir === "rtl" ? (
					<IconChevronLeft stroke={1.5} />
				) : (
					<IconChevronRight stroke={1.5} />
				)}
			</ActionIcon>
		</Tooltip>
	);
}

function SettingsButton({ t }: { t: TFunction }) {
	const { go } = useRoutes();

	return (
		<Tooltip label={t("navbar.settings")} withArrow>
			<ActionIcon
				variant="transparent"
				size="lg"
				onClick={() => go("settings")}
			>
				<IconSettings stroke={1.5} />
			</ActionIcon>
		</Tooltip>
	);
}
