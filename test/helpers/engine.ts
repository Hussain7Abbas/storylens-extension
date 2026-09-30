/// <reference types="bun" />

import type { AuthUser } from "../../src/lib/auth/auth-store";
import { FakeApi } from "./fake-api";
import { fakeBrowser, resetFakeBrowser } from "./fake-browser";
import { freshOfflineDb, secondContext } from "./offline-db";

const { axiosInstance, configureApiClient } = await import(
	"../../src/api/axios-instance"
);
configureApiClient("http://localhost");

let online = true;
Object.defineProperty(globalThis.navigator, "onLine", {
	configurable: true,
	get: () => online,
});

export function setOnline(value: boolean): void {
	online = value;
}

export const MODERATE = "user:moderate";

export function makeUser(
	id: string,
	options: { moderator?: boolean; guest?: boolean } = {},
): AuthUser {
	return {
		id,
		email: `${id}@example.invalid`,
		username: id,
		name: id,
		isGuest: options.guest ?? false,
		role: null,
		permissions: options.moderator ? [MODERATE] : [],
	};
}

/** Stores the signed-in session as the website bridge would. */
export async function signIn(
	user: AuthUser | null,
	token = user ? `token-${user.id}` : null,
): Promise<void> {
	if (!user) {
		await fakeBrowser.storage.local.remove("storylens-auth");
		return;
	}
	await fakeBrowser.storage.local.set({
		"storylens-auth": JSON.stringify({ user, token }),
	});
}

/** A fresh database, browser and API with a signed-in reader and a novel with lookups. */
export async function setupEngine(options: { moderator?: boolean } = {}) {
	resetFakeBrowser();
	setOnline(true);
	const db = await freshOfflineDb();
	const api = new FakeApi();
	axiosInstance.defaults.adapter = api.adapter;
	const user = makeUser("reader-1", options);
	api.addUser(user.id, { moderator: options.moderator ?? false });
	await signIn(user);
	const novel = api.seedNovel({ nameEn: "Novel", slugs: ["novel-slug"] });
	const category = api.seedLookup("category", { nameEn: "Hero" });
	const nature = api.seedLookup("nature", { nameEn: "Human" });
	return { db, api, user, novel, category, nature };
}

export { fakeBrowser, secondContext };
