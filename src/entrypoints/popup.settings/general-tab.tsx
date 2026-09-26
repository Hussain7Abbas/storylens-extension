import { Button, Fieldset, Group, Stack, Switch, Text } from "@mantine/core";
import { useAtom } from "jotai";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { browser } from "#imports";
import { PAGE_POPUP_VISIBLE_KEY } from "@/lib/page-popup-settings";
import { localeAtom } from "@/store/locale";
import { NodeSelector } from "../../components/node-selector/node-selector";

export function GeneralTab() {
	const { t } = useTranslation();
	const [locale, setLocale] = useAtom(localeAtom);
	const [popupVisible, setPopupVisible] = useState(true);
	const [popupLoaded, setPopupLoaded] = useState(false);
	useEffect(() => {
		void browser.storage.local.get(PAGE_POPUP_VISIBLE_KEY).then((stored) => {
			setPopupVisible(stored[PAGE_POPUP_VISIBLE_KEY] !== false);
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
				<Button onClick={handleChangeLanguage}>
					{locale === "ar"
						? t("settings.languageEnglish")
						: t("settings.languageArabic")}
				</Button>
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
			<Fieldset legend={t("settings.aboutStoryLens")}>
				<Group gap="sm">
					<Button
						component="a"
						href={`https://storylens.iscoded.com/${locale}/`}
						target="_blank"
						rel="noopener noreferrer"
						variant="subtle"
					>
						{t("settings.website")}
					</Button>
					<Button
						component="a"
						href={`https://storylens.iscoded.com/${locale}/privacy/`}
						target="_blank"
						rel="noopener noreferrer"
						variant="subtle"
					>
						{t("settings.privacyPolicy")}
					</Button>
					<Button
						component="a"
						href={`https://storylens.iscoded.com/${locale}/terms/`}
						target="_blank"
						rel="noopener noreferrer"
						variant="subtle"
					>
						{t("settings.termsOfUse")}
					</Button>
				</Group>
			</Fieldset>
			<Fieldset legend={t("nodeSelector.nodeSelector")}>
				<NodeSelector />
			</Fieldset>
		</Stack>
	);
}
