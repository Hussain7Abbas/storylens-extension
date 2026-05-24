import { useRoutes } from '@/hooks/useRoutes';
import { HomePage } from '../popup.home';
import { ProfilePage } from '../popup.profile';
import { SettingsPage } from '../popup.settings';

export type Routes = 'home' | 'settings' | 'profile';

export function Router() {
  const { current: currentRoute } = useRoutes();

  switch (currentRoute) {
    case 'home':
      return <HomePage />;
    case 'settings':
      return <SettingsPage />;
    case 'profile':
      return <ProfilePage />;
    default:
      return <HomePage />;
  }
}
