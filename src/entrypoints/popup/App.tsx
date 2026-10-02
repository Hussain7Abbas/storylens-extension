import "@/utils/i18n";
import "@mantine/core/styles.css";
import "@/styles/global.css";
import "./App.css";
import {
	Alert,
	Center,
	ColorSchemeScript,
	Loader,
	MantineProvider,
	ScrollArea,
	Stack,
	Text,
} from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { Toaster } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { browser } from "#imports";
import { PageContent } from "@/components/form-page";
import { LensCelebration } from "@/components/lens/lens-celebration";
import { Navbar } from "@/components/navbar";
import { Onboarding } from "@/components/onboarding/onboarding";
import { onboardingCompletedAtom, useAuthInit } from "@/lib/auth";
import { EXTRACTION_VIEW } from "@/lib/desktop-client/chapter-extraction";
import { NIGHT_LIGHT_LEVEL_KEY } from "@/lib/night-light";
import { isOfflineUnavailable, openOfflineDb } from "@/lib/offline/db";
import { useOfflineInvalidation } from "@/lib/offline/hooks";
import { usePopupAutoSync } from "@/lib/offline/use-popup-auto-sync";
import {
	APPEARANCE_FONT_FACE_KEY,
	APPEARANCE_FONT_SIZE_KEY,
	fontFaceAtom,
	fontSizeAtom,
	nightLightLevelAtom,
} from "@/store/appearance";
import { localeAtom } from "@/store/locale";
import { cssVariablesResolver, theme } from "@/styles/theme";
import { ExtractionView } from "../popup.extract/extraction-view";
import { Router } from "./routers";
import { SelectionView } from "./selection-view";

function PopupAutoSync({ enabled }: { enabled: boolean }) {
	usePopupAutoSync(enabled);
	useOfflineInvalidation();
	return null;
}

/** IndexedDB could not be opened (for example site data blocked): online-only mode. */
function OfflineUnavailableBanner() {
	const { t } = useTranslation();
	const [unavailable, setUnavailable] = useState(false);
	useEffect(() => {
		void openOfflineDb().then(() => setUnavailable(isOfflineUnavailable()));
	}, []);
	if (!unavailable) return null;
	return (
		<Alert color="orange" variant="light" radius={0} p="xs">
			<Text size="xs">{t("offline.storageUnavailable")}</Text>
		</Alert>
	);
}

function AppContent({ type }: { type: "popup" | "options" }) {
	const { loading } = useAuthInit();
	const onboardingCompleted = useAtomValue(onboardingCompletedAtom);
	const locale = useAtomValue(localeAtom);
	// The chapter panel embeds this page to show the AI character table only.
	const extraction =
		new URLSearchParams(window.location.search).get("view") === EXTRACTION_VIEW;
	// The page launcher embeds the popup in a larger iframe; fill it there.
	const fill = type === "options" || window.parent !== window;
	const height = fill ? "100vh" : "32rem";
	const width = fill ? "100vw" : "24rem";

	if (loading) {
		return (
			<Center h={extraction ? 120 : height} w={extraction ? "100%" : width}>
				<Loader />
			</Center>
		);
	}

	if (new URLSearchParams(window.location.search).get("view") === "selection")
		return (
			<div dir={locale === "ar" ? "rtl" : "ltr"}>
				<SelectionView />
			</div>
		);

	if (extraction) {
		return (
			<Stack w="100%" gap={0} dir={locale === "ar" ? "rtl" : "ltr"}>
				<ExtractionView />
			</Stack>
		);
	}

	if (!onboardingCompleted) {
		return (
			<Stack h={height} w={width} gap={0} dir={locale === "ar" ? "rtl" : "ltr"}>
				<Onboarding />
			</Stack>
		);
	}

	return (
		<>
			<PopupAutoSync enabled={type === "popup"} />
			<Stack h={height} w={width} gap={0} dir={locale === "ar" ? "rtl" : "ltr"}>
				<Navbar />
				<LensCelebration />
				<OfflineUnavailableBanner />
				<ScrollArea flex={1} type="auto">
					<PageContent>
						<Router />
					</PageContent>
				</ScrollArea>
			</Stack>
		</>
	);
}

function App({ type = "popup" }: { type: "popup" | "options" }) {
	const { i18n } = useTranslation();
	const locale = useAtomValue(localeAtom);
	const fontFace = useAtomValue(fontFaceAtom);
	const fontSize = useAtomValue(fontSizeAtom);
	const nightLightLevel = useAtomValue(nightLightLevelAtom);

	// One client for the popup's lifetime: locale and font changes re-render App
	// and must keep the cache and running mutations.
	const [queryClient] = useState(() => new QueryClient());

	useEffect(() => {
		i18n.changeLanguage(locale);
		document.documentElement.lang = locale;
		document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
		void browser.storage.local.set({ "storylens-locale": locale });
	}, [locale, i18n]);

	useEffect(() => {
		void browser.storage.local.set({ [APPEARANCE_FONT_FACE_KEY]: fontFace });
	}, [fontFace]);

	useEffect(() => {
		void browser.storage.local.set({ [APPEARANCE_FONT_SIZE_KEY]: fontSize });
	}, [fontSize]);

	useEffect(() => {
		void browser.storage.local.set({
			[NIGHT_LIGHT_LEVEL_KEY]: nightLightLevel,
		});
	}, [nightLightLevel]);

	return (
		<>
			<ColorSchemeScript defaultColorScheme="auto" />
			<MantineProvider
				theme={theme}
				cssVariablesResolver={cssVariablesResolver}
				defaultColorScheme="auto"
			>
				<QueryClientProvider client={queryClient}>
					<AppContent type={type} />
					<Toaster
						toastOptions={{
							style: {
								background: "var(--mantine-color-default)",
								color: "var(--mantine-color-text)",
								border: "1px solid var(--mantine-color-default-border)",
								boxShadow: "var(--mantine-shadow-md)",
								fontSize: "var(--mantine-font-size-sm)",
							},
						}}
					/>
				</QueryClientProvider>
			</MantineProvider>
		</>
	);
}

export default App;
