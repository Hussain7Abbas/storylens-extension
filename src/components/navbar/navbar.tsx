import {
	ActionIcon,
	Group,
	Image,
	Title,
	Tooltip,
	useComputedColorScheme,
	useMantineColorScheme,
} from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import cx from "clsx";
import type { TFunction } from "i18next";
import { useAtom, useAtomValue } from "jotai";
import {
	ChevronLeft as IconChevronLeft,
	ChevronRight as IconChevronRight,
	CloudUpload as IconCloudUpload,
	Languages as IconLanguage,
	Moon as IconMoon,
	RefreshCw as IconRefresh,
	Settings2 as IconSettings,
	Sun as IconSun,
	UserRound as IconUser,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import icon from "@/assets/icon.png";
import { sendMessage } from "@/entrypoints/background/messaging";
import { useRoutes } from "@/hooks/useRoutes";
import { userAccessAtom } from "@/lib/auth";
import { useOnlineStatus, usePendingSyncCount } from "@/lib/offline/hooks";
import { websitePageUrl } from "@/lib/website";
import { localeAtom } from "@/store/locale";
import { useActiveSyncCount } from "@/store/sync-status";
import { refreshContentScript } from "@/utils/refresh-content-script";
import classes from "./navbar.module.css";

export function Navbar() {
	const { t, i18n } = useTranslation();
	const dir = i18n.language === "ar" ? "rtl" : "ltr";
	const online = useOnlineStatus();
	const pendingCount = usePendingSyncCount();
	const activeSyncCount = useActiveSyncCount();
	const showSyncIndicator = pendingCount > 0 || activeSyncCount > 0;
	const isModerator = useAtomValue(userAccessAtom) === "moderator";
	const { canGoBack, current } = useRoutes();
	const isOnSettings = current === "settings";

	const pinnedAction =
		canGoBack || isOnSettings ? (
			<BackButton t={t} dir={dir} />
		) : (
			<SettingsButton t={t} />
		);

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
			<Group wrap="nowrap" gap="xs" className={classes.brand}>
				<Image src={icon} alt="" w={30} h={30} />
				<Title order={4} textWrap="nowrap" className={classes.wordmark}>
					{t("extName")}
					<span className={classes.brandDot} aria-hidden>
						.
					</span>
				</Title>
			</Group>
			<NavbarActionsScroll dir={dir} pinnedAction={pinnedAction}>
				{showSyncIndicator && (
					<SyncButton
						t={t}
						pendingCount={pendingCount}
						activeSyncCount={activeSyncCount}
						online={online}
					/>
				)}
				<RefreshContentButton t={t} />
				<ToggleColorScheme t={t} />
				{!isModerator && <ToggleLanguage t={t} />}
				{!isOnSettings && <ProfileButton t={t} />}
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
		if (element.firstElementChild) observer.observe(element.firstElementChild);
		const directionObserver = new MutationObserver(updateFade);
		directionObserver.observe(element, {
			attributes: true,
			attributeFilter: ["dir"],
		});
		element.addEventListener("scroll", updateFade, { passive: true });

		return () => {
			observer.disconnect();
			directionObserver.disconnect();
			element.removeEventListener("scroll", updateFade);
		};
	}, [updateFade]);

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
	activeSyncCount,
	online,
}: {
	t: TFunction;
	pendingCount: number;
	activeSyncCount: number;
	online: boolean;
}) {
	const [syncing, setSyncing] = useState(false);
	const queryClient = useQueryClient();
	const isBackgroundActive = activeSyncCount > 0 || syncing;

	const handleSync = async () => {
		if (!online) {
			toast.error(t("offline.syncRequiresOnline"));
			return;
		}

		setSyncing(true);
		try {
			const result = await sendMessage("triggerFullSync");
			await queryClient.invalidateQueries({ queryKey: ["offline"] });
			if (result.failed > 0 || result.remaining > 0) {
				const permissionDenied = result.errors.some(
					(error) => error.status === 403,
				);
				const details = [
					...new Set(
						result.errors.map((error) => `${error.entity}: ${error.message}`),
					),
				].join("; ");
				toast.error(
					`${t(permissionDenied ? "offline.syncPermissionDenied" : "offline.syncIncomplete", { count: result.remaining })}${details ? `: ${details}` : ""}`,
					{ duration: 10000 },
				);
				return;
			}
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
				variant="subtle"
				color="var(--mantine-color-dimmed)"
				radius="sm"
				size="lg"
				aria-label={t("offline.syncNow")}
				loading={isBackgroundActive}
				onClick={() => {
					void handleSync();
				}}
			>
				<IconCloudUpload strokeWidth={1.75} />
			</ActionIcon>
		</Tooltip>
	);
}

// Account pages live on the website so browser password managers can fill them.
function ProfileButton({ t }: { t: TFunction }) {
	const locale = useAtomValue(localeAtom);

	return (
		<Tooltip label={t("navbar.profile")} withArrow>
			<ActionIcon
				component="a"
				href={websitePageUrl(locale, "profile/")}
				target="_blank"
				rel="noopener noreferrer"
				variant="subtle"
				color="var(--mantine-color-dimmed)"
				radius="sm"
				size="lg"
				aria-label={t("navbar.profile")}
			>
				<IconUser strokeWidth={1.75} />
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
				variant="subtle"
				color="var(--mantine-color-dimmed)"
				radius="sm"
				size="lg"
				aria-label={t("navbar.refreshContent")}
				loading={refreshing}
				onClick={() => {
					void handleRefresh();
				}}
			>
				<IconRefresh strokeWidth={1.75} />
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
				variant="subtle"
				color="var(--mantine-color-dimmed)"
				radius="sm"
				size="lg"
				aria-label={t("navbar.toggleColorScheme")}
			>
				<IconSun
					className={cx(classes.icon, classes.light)}
					strokeWidth={1.75}
				/>
				<IconMoon
					className={cx(classes.icon, classes.dark)}
					strokeWidth={1.75}
				/>
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
				variant="subtle"
				color="var(--mantine-color-dimmed)"
				radius="sm"
				size="lg"
				aria-label={t("navbar.switchLanguage")}
				onClick={toggleLanguage}
			>
				<IconLanguage strokeWidth={1.75} />
			</ActionIcon>
		</Tooltip>
	);
}

function BackButton({ t, dir }: { t: TFunction; dir: "rtl" | "ltr" }) {
	const { back } = useRoutes();

	return (
		<Tooltip label={t("_.back")} withArrow>
			<ActionIcon
				variant="subtle"
				color="var(--mantine-color-dimmed)"
				radius="sm"
				size="lg"
				aria-label={t("_.back")}
				onClick={() => back()}
			>
				{dir === "rtl" ? (
					<IconChevronRight strokeWidth={1.75} />
				) : (
					<IconChevronLeft strokeWidth={1.75} />
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
				variant="subtle"
				color="var(--mantine-color-dimmed)"
				radius="sm"
				size="lg"
				aria-label={t("navbar.settings")}
				onClick={() => go("settings")}
			>
				<IconSettings strokeWidth={1.75} />
			</ActionIcon>
		</Tooltip>
	);
}
