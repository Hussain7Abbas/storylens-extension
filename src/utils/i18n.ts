import i18n from 'i18next';
import HttpBackend from 'i18next-http-backend';
import { initReactI18next } from 'react-i18next';

i18n
  .use(HttpBackend) // load translations from JSON files
  .use(initReactI18next)
  .init({
    backend: {
      loadPath: '/locales/{{lng}}.json',
    },
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
    lng: 'en', // default language
    react: {
      useSuspense: false,
    },
  });

export default i18n;
