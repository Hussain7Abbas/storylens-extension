import { useEffect } from "react";
import { useRoutes } from "@/hooks/useRoutes";
import { trackEvent } from "@/lib/analytics/client";
import { HomePage } from "../popup.home";
import { SettingsPage } from "../popup.settings";
import { SyncPage } from "../popup.sync/sync-page";

export type Routes = "home" | "settings" | "sync";

export function Router() {
	const { current: currentRoute } = useRoutes();

	useEffect(() => {
		trackEvent("page_view", {
			page_title: currentRoute,
			page_location: `/${currentRoute}`,
			embedded: window.parent !== window,
		});
	}, [currentRoute]);

	switch (currentRoute) {
		case "home":
			return <HomePage />;
		case "settings":
			return <SettingsPage />;
		case "sync":
			return <SyncPage />;
		default:
			return <HomePage />;
	}
}
