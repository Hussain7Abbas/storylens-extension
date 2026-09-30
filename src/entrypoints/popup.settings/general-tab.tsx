import {
	Button,
	Fieldset,
	Group,
	Stack,
	Switch,
	Text,
	Tooltip,
} from "@mantine/core";
import { useAtom } from "jotai";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { browser } from "#imports";
import { ANALYTICS_ENABLED_KEY } from "@/lib/analytics/types";
import { PAGE_POPUP_VISIBLE_KEY } from "@/lib/page-popup-settings";
import { websitePageUrl } from "@/lib/website";
import { localeAtom } from "@/store/locale";
import { NodeSelector } from "../../components/node-selector/node-selector";

export function GeneralTab() {
	const { t } = useTranslation();
	const [locale, setLocale] = useAtom(localeAtom);
	const [popupVisible, setPopupVisible] = useState(true);
	const [popupLoaded, setPopupLoaded] = useState(false);
	const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
	useEffect(() => {
		void browser.storage.local
			.get([PAGE_POPUP_VISIBLE_KEY, ANALYTICS_ENABLED_KEY])
			.then((stored) => {
				setPopupVisible(stored[PAGE_POPUP_VISIBLE_KEY] !== false);
				setAnalyticsEnabled(stored[ANALYTICS_ENABLED_KEY] !== false);
				setPopupLoaded(true);
			});
		const onChange = (
			changes: Record<string, { newValue?: unknown }>,
			area: string,
		) => {
			if (area === "local" && PAGE_POPUP_VISIBLE_KEY in changes) {
				setPopupVisible(changes[PAGE_POPUP_VISIBLE_KEY].newValue !== false);
			}
		};
		browser.storage.onChanged.addListener(onChange);
		return () => browser.storage.onChanged.removeListener(onChange);
	}, []);
	function handleChangeLanguage() {
		setLocale(locale === "ar" ? "en" : "ar");
	}
	return (
		<Stack gap="xs" p="md">
			<Group>
				<Text>{t("settings.language")}:</Text>
				<Tooltip
					label={
						locale === "ar"
							? t("settings.languageEnglish")
							: t("settings.languageArabic")
					}
					withArrow
					openDelay={350}
				>
					<Button onClick={handleChangeLanguage}>
						{locale === "ar"
							? t("settings.languageEnglish")
							: t("settings.languageArabic")}
					</Button>
				</Tooltip>
			</Group>
			<Switch
				label={t("settings.inSitePopup")}
				description={popupVisible ? t("settings.show") : t("settings.hide")}
				checked={popupVisible}
				disabled={!popupLoaded}
				onChange={(event) => {
					const visible = event.currentTarget.checked;
					void browser.storage.local.set({ [PAGE_POPUP_VISIBLE_KEY]: visible });
					setPopupVisible(visible);
				}}
			/>
			<Switch
				label={t("settings.usageAnalytics")}
				description={t("settings.usageAnalyticsDescription")}
				checked={analyticsEnabled}
				disabled={!popupLoaded}
				onChange={(event) => {
					const enabled = event.currentTarget.checked;
					void browser.storage.local.set({ [ANALYTICS_ENABLED_KEY]: enabled });
					setAnalyticsEnabled(enabled);
				}}
			/>
			<Fieldset legend={t("settings.aboutStoryLens")}>
				<Group gap="sm">
					<Tooltip label={t("settings.website")} withArrow openDelay={350}>
						<Button
							component="a"
							href={websitePageUrl(locale, "")}
							target="_blank"
							rel="noopener noreferrer"
							variant="subtle"
						>
							{t("settings.website")}
						</Button>
					</Tooltip>
					<Tooltip
						label={t("settings.privacyPolicy")}
						withArrow
						openDelay={350}
					>
						<Button
							component="a"
							href={websitePageUrl(locale, "privacy/")}
							target="_blank"
							rel="noopener noreferrer"
							variant="subtle"
						>
							{t("settings.privacyPolicy")}
						</Button>
					</Tooltip>
					<Tooltip label={t("settings.termsOfUse")} withArrow openDelay={350}>
						<Button
							component="a"
							href={websitePageUrl(locale, "terms/")}
							target="_blank"
							rel="noopener noreferrer"
							variant="subtle"
						>
							{t("settings.termsOfUse")}
						</Button>
					</Tooltip>
				</Group>
			</Fieldset>
			<Fieldset legend={t("nodeSelector.nodeSelector")}>
				<NodeSelector />
			</Fieldset>
			<Text size="sm" c="dimmed">
				{t("settings.version")}: {browser.runtime.getManifest().version}
			</Text>
		</Stack>
	);
}
