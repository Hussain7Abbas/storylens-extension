import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  imports: false,
  modules: [
    '@wxt-dev/module-react',
    '@wxt-dev/auto-icons',
    '@wxt-dev/webextension-polyfill',
  ],
  srcDir: 'src',
  hooks: {
    'build:manifestGenerated': (wxt, manifest) => {
      if (wxt.config.mode !== 'development') {
        return;
      }

      const devServerPort = wxt.config.dev?.server?.port ?? 3000;
      const devServerOrigin = `http://localhost:${devServerPort}`;
      const csp = manifest.content_security_policy;

      if (csp && typeof csp === 'object' && typeof csp.extension_pages === 'string') {
        csp.extension_pages += ` style-src 'self' 'unsafe-inline' ${devServerOrigin};`;
      }
    },
  },

  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    permissions: ['tabs'],
    host_permissions: ['http://localhost/*', 'http://127.0.0.1/*'],
  },

  webExt: {
    binaries: {
      chromium: '/usr/bin/chromium',
    },
    chromiumArgs: ['--user-data-dir=./.wxt/chromium-data'],
    keepProfileChanges: true,
    startUrls: ['https://rewayat.club/novel/hail-the-king/72'],
  },
});
