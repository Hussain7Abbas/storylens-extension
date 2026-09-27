import { useRoutes } from "@/hooks/useRoutes";
import { HomePage } from "../popup.home";
import { SettingsPage } from "../popup.settings";

export type Routes = "home" | "settings";

export function Router() {
	const { current: currentRoute } = useRoutes();

	switch (currentRoute) {
		case "home":
			return <HomePage />;
		case "settings":
			return <SettingsPage />;
		default:
			return <HomePage />;
	}
}
