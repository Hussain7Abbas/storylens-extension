import { atom, useAtom } from "jotai";
import { formPageAtom } from "@/components/form-page";
import type { Routes } from "@/entrypoints/popup/routers";

const routesAtom = atom<Routes[]>(["home"]);
const prevRouteAtom = atom<Routes[]>([]);

export function useRoutes() {
	const [formPage] = useAtom(formPageAtom);
	const [routes, setRoutes] = useAtom(routesAtom);
	const [prevRoutes, setPrevRoutes] = useAtom(prevRouteAtom);

	function push(route: Routes) {
		setRoutes((prev) => {
			if (prev[prev.length - 1] === route) {
				return prev;
			}
			return [...prev, route];
		});
		setPrevRoutes([]);
		return route;
	}

	function pop() {
		const poppedRoute = routes[routes.length - 1];
		if (routes.length <= 1) return poppedRoute;
		setRoutes((prev) => prev.slice(0, -1));
		setPrevRoutes((prev) => [...prev, poppedRoute]);
		return poppedRoute;
	}

	function replace(route: Routes) {
		setRoutes((prev) => [...prev.slice(0, -1), route]);
		return route;
	}

	function go(route: Routes) {
		return push(route);
	}

	function back() {
		if (formPage) {
			formPage.close();
			return routes[routes.length - 1];
		}
		return pop();
	}

	function forward() {
		const prevRoute = prevRoutes[prevRoutes.length - 1];
		if (!prevRoute) return routes[routes.length - 1];
		setPrevRoutes((prev) => prev.slice(0, -1));
		setRoutes((prev) => [...prev, prevRoute]);
		return prevRoute;
	}

	function goHome() {
		setRoutes(["home"]);
		setPrevRoutes([]);
	}

	function refresh() {
		push("home");
		pop();
	}

	return {
		canGoBack: !!formPage || routes.length > 1,
		back,
		current: routes[routes.length - 1],
		forward,
		go,
		goHome,
		pop,
		push,
		replace,
		routes,
		refresh,
	};
}
