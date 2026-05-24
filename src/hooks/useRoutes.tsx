import { atom, useAtom } from 'jotai';
import type { Routes } from '@/entrypoints/popup/routers';

const routesAtom = atom<Routes[]>(['home']);
const prevRouteAtom = atom<Routes[]>([]);

export function useRoutes() {
  const [routes, setRoutes] = useAtom(routesAtom);
  const [prevRoutes, setPrevRoutes] = useAtom(prevRouteAtom);

  function push(route: Routes) {
    setRoutes((prev) => [...prev, route]);
    return route;
  }

  function pop() {
    const poppedRoute = routes[routes.length - 1];
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
    return pop();
  }

  function forward() {
    const prevRoute = prevRoutes[prevRoutes.length - 1];
    setPrevRoutes((prev) => prev.slice(0, -1));
    setRoutes((prev) => [...prev.slice(0, -1), prevRoute]);
    return prevRoute;
  }

  function refresh() {
    push('home');
    pop();
  }

  return {
    back,
    current: routes[routes.length - 1],
    forward,
    go,
    pop,
    push,
    replace,
    routes,
    refresh,
  };
}
