import {
	ActionIcon,
	Menu,
	useComputedColorScheme,
	useMantineColorScheme,
} from "@mantine/core";
import { useAtom, useAtomValue } from "jotai";
import {
	EllipsisVertical,
	ExternalLink,
	Languages,
	Moon,
	RefreshCw,
	Settings2,
	Sun,
	UserRound,
} from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useRoutes } from "@/hooks/useRoutes";
import { userAccessAtom } from "@/lib/auth";
import { websitePageUrl } from "@/lib/website";
import { localeAtom } from "@/store/locale";
import { refreshContentScript } from "@/utils/refresh-content-script";
export function NavbarMenu() {
	const { t } = useTranslation();
	const [locale, setLocale] = useAtom(localeAtom);
	const moderator = useAtomValue(userAccessAtom) === "moderator";
	const { current, go } = useRoutes();
	const { setColorScheme } = useMantineColorScheme();
	const scheme = useComputedColorScheme("light", {
		getInitialValueInEffect: true,
	});
	const icon = (Icon: typeof RefreshCw) => (
		<Icon size={16} strokeWidth={1.75} aria-hidden />
	);
	const refresh = async () => {
		const id = toast.loading(t("navbar.refreshContent"));
		try {
			if (!(await refreshContentScript()))
				toast.error(t("navbar.refreshContentFailed"));
		} catch {
			toast.error(t("navbar.refreshContentFailed"));
		} finally {
			toast.dismiss(id);
		}
	};
	return (
		<Menu
			position={locale === "ar" ? "bottom-start" : "bottom-end"}
			withinPortal
		>
			<Menu.Target>
				<ActionIcon
					variant="subtle"
					color="var(--mantine-color-dimmed)"
					size="md"
					aria-label={t("navbar.more")}
				>
					<EllipsisVertical size={22} strokeWidth={1.75} />
				</ActionIcon>
			</Menu.Target>
			<Menu.Dropdown>
				<Menu.Item
					leftSection={icon(RefreshCw)}
					onClick={() => {
						void refresh();
					}}
				>
					{t("navbar.refreshContent")}
				</Menu.Item>
				<Menu.Item
					leftSection={icon(scheme === "light" ? Moon : Sun)}
					onClick={() => setColorScheme(scheme === "light" ? "dark" : "light")}
				>
					{t(scheme === "light" ? "navbar.darkTheme" : "navbar.lightTheme")}
				</Menu.Item>
				{!moderator && (
					<Menu.Item
						leftSection={icon(Languages)}
						onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
					>
						{locale === "ar" ? "English" : "العربية"}
					</Menu.Item>
				)}
				<Menu.Item
					leftSection={icon(UserRound)}
					rightSection={icon(ExternalLink)}
					component="a"
					href={websitePageUrl(locale, "profile/")}
					target="_blank"
					rel="noopener noreferrer"
				>
					{t("navbar.profile")}
				</Menu.Item>
				{current !== "settings" && (
					<Menu.Item
						leftSection={icon(Settings2)}
						onClick={() => go("settings")}
					>
						{t("navbar.settings")}
					</Menu.Item>
				)}
			</Menu.Dropdown>
		</Menu>
	);
}
