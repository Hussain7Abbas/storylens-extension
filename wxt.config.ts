import { defineConfig } from "wxt";

const defaultDevApiUrl = "http://localhost:7001";
const productionApiUrl = "https://storylens-api.iscoded.com";
const isProductionBuild = process.env.NODE_ENV === "production";
const apiUrl = isProductionBuild
	? productionApiUrl
	: (process.env.WXT_API_URL ?? defaultDevApiUrl);

function apiHostPermission(url: string): string {
	const { protocol, hostname, port } = new URL(url);
	const host = port ? `${hostname}:${port}` : hostname;
	return `${protocol}//${host}/*`;
}

const devHostPermissions = ["http://localhost/*", "http://127.0.0.1/*"];
// GA4 Measurement Protocol endpoint used by src/lib/analytics/background.ts.
const analyticsHostPermission = "https://www.google-analytics.com/*";
const productionHostPermissions = [
	apiHostPermission(apiUrl),
	"http://127.0.0.1/*",
	analyticsHostPermission,
];

// See https://wxt.dev/api/config.html
export default defineConfig({
	imports: false,
	modules: [
		"@wxt-dev/module-react",
		"@wxt-dev/auto-icons",
		"@wxt-dev/webextension-polyfill",
	],
	srcDir: "src",
	// Auto-icons merges these with its standard 16/32/48/128px sizes.
	autoIcons: { sizes: [64, 256, 512] },
	hooks: {
		"build:manifestGenerated": (wxt, manifest) => {
			if (wxt.config.mode !== "development") {
				return;
			}

			const devServerPort = wxt.config.dev?.server?.port ?? 3000;
			const devServerOrigin = `http://localhost:${devServerPort}`;
			const csp = manifest.content_security_policy;

			if (
				csp &&
				typeof csp === "object" &&
				typeof csp.extension_pages === "string"
			) {
				csp.extension_pages += ` style-src 'self' 'unsafe-inline' ${devServerOrigin};`;
			}
		},
	},

	manifest: {
		name: "__MSG_extName__",
		description: "__MSG_extDescription__",
		default_locale: "en",
		permissions: ["tabs", "storage", "alarms", "unlimitedStorage"],
		web_accessible_resources: [
			{
				resources: ["popup.html", "icons/128.png"],
				matches: ["http://*/*", "https://*/*"],
			},
		],
		host_permissions:
			process.env.NODE_ENV === "development"
				? [...devHostPermissions, ...productionHostPermissions]
				: productionHostPermissions,
	},

	webExt: {
		binaries: {
			chromium: "/usr/bin/chromium",
		},
		chromiumArgs: ["--user-data-dir=./.wxt/chromium-data"],
		keepProfileChanges: true,
		startUrls: ["https://seanovel.org/novels/shadow-slave/chapters/235"],
	},
});
