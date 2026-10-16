import { browser } from "#imports";
import {
	getColorPreferences,
	putColorPreferencesByKindById,
} from "@/api/generated/endpoints/color-preferences";
import { getStoredAuth } from "@/lib/auth/auth-storage";
import {
	applyColorChange,
	type ColorChange,
	isHexColor,
	parseColorPreferences,
	parsePersonalColors,
	personalColorsKey,
} from "./types";

// Web Locks serialize extension contexts; this fallback only schedules work in
// runtimes without them. All durable data lives in extension storage.
const localLocks = new Map<string, Promise<unknown>>();
async function locked<T>(
	name: string,
	task: () => Promise<T>,
	skipBusy = false,
): Promise<T | undefined> {
	if (globalThis.navigator?.locks) {
		return navigator.locks.request(name, { ifAvailable: skipBusy }, (lock) =>
			lock ? task() : Promise.resolve(undefined),
		);
	}
	const previous = localLocks.get(name);
	if (skipBusy && previous) return;
	const current = (async () => {
		await previous?.catch(() => undefined);
		return task();
	})();
	localLocks.set(name, current);
	try {
		return await current;
	} finally {
		if (localLocks.get(name) === current) localLocks.delete(name);
	}
}

export async function readColorPreferences(userId: string) {
	const key = personalColorsKey(userId);
	const data = await browser.storage.local.get(key);
	return parseColorPreferences(data[key]);
}
async function edit(
	userId: string,
	update: (state: Awaited<ReturnType<typeof readColorPreferences>>) => void,
) {
	return locked(personalColorsKey(userId), async () => {
		const state = await readColorPreferences(userId);
		update(state);
		await browser.storage.local.set({ [personalColorsKey(userId)]: state });
	});
}
/** Only trusted extension pages call this; the owner is verified against the current session. */
export async function savePersonalColor(
	userId: string,
	change: ColorChange,
): Promise<void> {
	const { user } = await getStoredAuth();
	if (!user || user.id !== userId)
		throw new Error("Account changed. Open the settings again.");
	if (
		(change.kind !== "category" && change.kind !== "nature") ||
		!/^[0-9a-f-]{36}$/i.test(change.id) ||
		(change.color !== null && !isHexColor(change.color))
	)
		throw new Error("Invalid personal color");
	await edit(userId, (state) => {
		applyColorChange(state.colors, change);
		state.pending[`${change.kind}/${change.id}`] = {
			...change,
			revision: crypto.randomUUID(),
		};
	});
}
/** Full account snapshot plus durable local edits. Last applied server write wins per color. */
export async function syncPersonalColors(): Promise<void> {
	const { user, token } = await getStoredAuth();
	if (
		!user ||
		!token ||
		(typeof navigator !== "undefined" && navigator.onLine === false)
	)
		return;
	await locked(
		`${personalColorsKey(user.id)}:sync`,
		async () => {
			const options = {
				headers: { Authorization: `Bearer ${token}` },
				timeout: 20_000,
			};
			try {
				const start = await readColorPreferences(user.id);
				// Verify that this API supports preferences before acknowledging any queued edits.
				const initial = await getColorPreferences(options);
				for (const [key, change] of Object.entries(start.pending)) {
					if ((await getStoredAuth()).user?.id !== user.id) return;
					try {
						await putColorPreferencesByKindById(
							change.kind,
							change.id,
							{ color: change.color },
							options,
						);
					} catch (error) {
						// A removed lookup has no color to customize; drop only this obsolete edit.
						if (
							!(
								error &&
								typeof error === "object" &&
								"response" in error &&
								(error.response as { status?: number })?.status === 404
							)
						)
							throw error;
					}
					await edit(user.id, (state) => {
						if (state.pending[key]?.revision === change.revision)
							delete state.pending[key];
					});
				}
				if ((await getStoredAuth()).user?.id !== user.id) return;
				const response = Object.keys(start.pending).length
					? await getColorPreferences(options)
					: initial;
				const colors = parsePersonalColors(response.data);
				await edit(user.id, (state) => {
					state.colors = colors;
					for (const change of Object.values(state.pending))
						applyColorChange(state.colors, change);
					state.syncError = false;
				});
			} catch {
				await edit(user.id, (state) => {
					state.syncError = true;
				});
			}
		},
		true,
	);
}
