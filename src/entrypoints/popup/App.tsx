import "@/utils/i18n";
import "@mantine/core/styles.css";
import "@/styles/global.css";
import "./App.css";
import {
	Center,
	ColorSchemeScript,
	Loader,
	MantineProvider,
	ScrollArea,
	Stack,
} from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { Toaster } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { Navbar } from "@/components/navbar";
import { Onboarding } from "@/components/onboarding/onboarding";
import { onboardingCompletedAtom, useAuthInit } from "@/lib/auth";
import { usePopupAutoSync } from "@/lib/offline/use-popup-auto-sync";
import { localeAtom } from "@/store/locale";
import { Router } from "./routers";

function PopupAutoSync({ enabled }: { enabled: boolean }) {
	usePopupAutoSync(enabled);
	return null;
}

function AppContent({ type }: { type: "popup" | "options" }) {
	const { loading } = useAuthInit();
	const onboardingCompleted = useAtomValue(onboardingCompletedAtom);
	const locale = useAtomValue(localeAtom);

	if (loading) {
		return (
			<Center
				h={type === "popup" ? "32rem" : "100vh"}
				w={type === "popup" ? "24rem" : "100vw"}
			>
				<Loader />
			</Center>
		);
	}

	if (!onboardingCompleted) {
		return (
			<Stack
				h={type === "popup" ? "32rem" : "100vh"}
				w={type === "popup" ? "24rem" : "100vw"}
				gap={0}
				dir={locale === "ar" ? "rtl" : "ltr"}
			>
				<Onboarding />
			</Stack>
		);
	}

	return (
		<>
			<PopupAutoSync enabled={type === "popup"} />
			<Stack
				h={type === "popup" ? "32rem" : "100vh"}
				w={type === "popup" ? "24rem" : "100vw"}
				gap={0}
				dir={locale === "ar" ? "rtl" : "ltr"}
			>
				<Navbar />
				<ScrollArea flex={1} type="auto">
					<Router />
				</ScrollArea>
			</Stack>
		</>
	);
}

function App({ type = "popup" }: { type: "popup" | "options" }) {
	const { i18n } = useTranslation();
	const locale = useAtomValue(localeAtom);

	const queryClient = new QueryClient();

	useEffect(() => {
		i18n.changeLanguage(locale);
	}, [locale, i18n]);

	return (
		<>
			<ColorSchemeScript defaultColorScheme="auto" />
			<MantineProvider defaultColorScheme="auto">
				<QueryClientProvider client={queryClient}>
					<AppContent type={type} />
					<Toaster />
				</QueryClientProvider>
			</MantineProvider>
		</>
	);
}

export default App;
