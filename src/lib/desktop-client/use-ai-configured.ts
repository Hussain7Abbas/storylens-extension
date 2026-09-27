import { atom, useAtomValue } from "jotai";
import { browser } from "#imports";
import { isAiConfigured } from "./ai-config";
import { parseDesktopSettings } from "./settings";
import { DESKTOP_SETTINGS_KEY } from "./types";

/**
 * Whether AI actions are usable, shared by every extension page. It follows
 * the stored desktop settings, so saving them in Settings → AI enables AI
 * actions everywhere without reopening the popup.
 */
const aiConfiguredAtom = atom(false);
aiConfiguredAtom.onMount = (set) => {
	let active = true;
	void browser.storage.local.get(DESKTOP_SETTINGS_KEY).then((stored) => {
		if (active)
			set(isAiConfigured(parseDesktopSettings(stored[DESKTOP_SETTINGS_KEY])));
	});
	const onChange: Parameters<typeof browser.storage.onChanged.addListener>[0] =
		(changes, area) => {
			if (area !== "local" || !(DESKTOP_SETTINGS_KEY in changes)) return;
			set(
				isAiConfigured(
					parseDesktopSettings(changes[DESKTOP_SETTINGS_KEY].newValue),
				),
			);
		};
	browser.storage.onChanged.addListener(onChange);
	return () => {
		active = false;
		browser.storage.onChanged.removeListener(onChange);
	};
};

export function useAiConfigured(): boolean {
	return useAtomValue(aiConfiguredAtom);
}
