import { useAtomValue } from "jotai";
import { useRoutes } from "@/hooks/useRoutes";
import { userRoleAtom } from "@/lib/auth";
import { HomePage } from "../popup.home";
import { ProfilePage } from "../popup.profile";
import { SettingsPage } from "../popup.settings";

export type Routes = "home" | "settings" | "profile";

export function Router() {
	const { current: currentRoute } = useRoutes();
	const role = useAtomValue(userRoleAtom);

	switch (currentRoute) {
		case "home":
			return <HomePage />;
		case "settings":
			if (role !== "admin") {
				return <HomePage />;
			}
			return <SettingsPage />;
		case "profile":
			return <ProfilePage />;
		default:
			return <HomePage />;
	}
}
