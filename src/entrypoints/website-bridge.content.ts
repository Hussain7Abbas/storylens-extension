import { browser, defineContentScript } from "#imports";
import {
	AUTH_STORAGE_KEY,
	clearAuth,
	getStoredAuth,
	parseStoredAuth,
	storeAuth,
} from "@/lib/auth/auth-storage";
import { websiteMatchPattern } from "@/lib/website";
import {
	ACCOUNT_BRIDGE_CHANNEL,
	type ExtensionMessage,
	parsePageRequest,
} from "@/lib/website/account-bridge";

// Shares the extension session with the Story Lens website's account pages.
// Runs only on the configured website origin.
export default defineContentScript({
	matches: [websiteMatchPattern()],
	runAt: "document_start",
	main(ctx) {
		const post = (session: ExtensionMessage["session"], id?: string): void => {
			const message: ExtensionMessage = {
				channel: ACCOUNT_BRIDGE_CHANNEL,
				from: "extension",
				type: "session",
				session: session?.token ? session : null,
				...(id ? { id } : {}),
			};
			window.postMessage(message, window.location.origin);
		};

		const handleMessage = (event: MessageEvent): void => {
			if (event.source !== window || event.origin !== window.location.origin) {
				return;
			}
			const request = parsePageRequest(event.data);
			if (!request) return;
			void (async () => {
				if (request.type === "set") {
					await storeAuth(request.session.user, request.session.token);
				} else if (request.type === "clear") {
					await clearAuth();
				}
				post(await getStoredAuth(), request.id);
			})();
		};

		const handleStorage = (
			changes: Record<string, { newValue?: unknown }>,
			area: string,
		): void => {
			if (area !== "local" || !(AUTH_STORAGE_KEY in changes)) return;
			post(parseStoredAuth(changes[AUTH_STORAGE_KEY]?.newValue));
		};

		window.addEventListener("message", handleMessage);
		browser.storage.onChanged.addListener(handleStorage);
		ctx.onInvalidated(() => {
			window.removeEventListener("message", handleMessage);
			browser.storage.onChanged.removeListener(handleStorage);
		});

		void getStoredAuth().then((session) => post(session));
	},
});
