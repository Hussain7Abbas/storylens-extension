import { beforeEach, describe, expect, it } from "bun:test";
import { makeUser, setOnline, setupEngine, signIn } from "./helpers/engine";

const { readColorPreferences, savePersonalColor, syncPersonalColors } =
	await import("../src/lib/personal-colors/background");

import { personalColorsKey } from "../src/lib/personal-colors/types";

const { getSyncStatus } = await import("../src/lib/offline/sync/status");
let env: Awaited<ReturnType<typeof setupEngine>>;
beforeEach(async () => {
	env = await setupEngine();
});
describe("personal color sync", () => {
	it("saves offline for a guest, preserves original colors, and syncs once reconnected", async () => {
		const guest = makeUser("guest-colors", { guest: true });
		env.api.addUser(guest.id, { isGuest: true });
		await signIn(guest);
		setOnline(false);
		await savePersonalColor(guest.id, {
			kind: "category",
			id: env.category.id,
			color: "#abcdef",
		});
		await syncPersonalColors();
		expect(
			(await readColorPreferences(guest.id)).colors.category[env.category.id],
		).toBe("#abcdef");
		expect((await getSyncStatus(env.db)).pending).toBe(1);
		expect(env.api.personalColors.has(guest.id)).toBe(false);
		setOnline(true);
		await syncPersonalColors();
		expect(
			env.api.personalColors.get(guest.id)?.category[env.category.id],
		).toBe("#abcdef");
		expect((await readColorPreferences(guest.id)).pending).toEqual({});
		expect(env.api.categories.get(env.category.id)?.color).toBe(
			env.category.color,
		);
	});
	it("downloads changes from another device and syncs clearing", async () => {
		env.api.personalColors.set(env.user.id, {
			category: { [env.category.id]: "#123456" },
			nature: { [env.nature.id]: "#654321" },
		});
		await syncPersonalColors();
		expect(
			(await readColorPreferences(env.user.id)).colors.nature[env.nature.id],
		).toBe("#654321");
		await savePersonalColor(env.user.id, {
			kind: "nature",
			id: env.nature.id,
			color: null,
		});
		expect((await readColorPreferences(env.user.id)).colors.nature).toEqual({});
		await syncPersonalColors();
		expect(env.api.personalColors.get(env.user.id)?.nature).toEqual({});
	});
	it("holds other accounts' edits and ignores their colors", async () => {
		await savePersonalColor(env.user.id, {
			kind: "category",
			id: env.category.id,
			color: "#abcdef",
		});
		const other = makeUser("another-reader");
		env.api.addUser(other.id);
		await signIn(other);
		await syncPersonalColors();
		expect(env.api.personalColors.has(env.user.id)).toBe(false);
		expect((await readColorPreferences(other.id)).colors.category).toEqual({});
		expect(
			Object.keys((await readColorPreferences(env.user.id)).pending),
		).toHaveLength(1);
		await expect(
			savePersonalColor(env.user.id, {
				kind: "category",
				id: env.category.id,
				color: "#123456",
			}),
		).rejects.toThrow("Account changed");
	});
	it("retains a newer edit made while an older revision is being sent", async () => {
		await savePersonalColor(env.user.id, {
			kind: "category",
			id: env.category.id,
			color: "#111111",
		});
		const adapter = env.api.adapter;
		let newer = false;
		const { axiosInstance } = await import("../src/api/axios-instance");
		axiosInstance.defaults.adapter = async (config) => {
			if (config.method === "put" && !newer) {
				newer = true;
				await savePersonalColor(env.user.id, {
					kind: "category",
					id: env.category.id,
					color: "#222222",
				});
			}
			return adapter(config);
		};
		await syncPersonalColors();
		const state = await readColorPreferences(env.user.id);
		expect(state.colors.category[env.category.id]).toBe("#222222");
		expect(Object.values(state.pending)[0]?.color).toBe("#222222");
		await syncPersonalColors();
		expect(
			env.api.personalColors.get(env.user.id)?.category[env.category.id],
		).toBe("#222222");
		expect((await readColorPreferences(env.user.id)).pending).toEqual({});
	});
	it("keeps edits on network/server failure or an older API and reports the failure", async () => {
		await savePersonalColor(env.user.id, {
			kind: "category",
			id: env.category.id,
			color: "#abcdef",
		});
		env.api.failNext(
			{ kind: "status", status: 404 },
			(method, path) => method === "GET" && path.includes("color-preferences"),
		);
		await syncPersonalColors();
		expect(
			Object.keys((await readColorPreferences(env.user.id)).pending),
		).toHaveLength(1);
		expect(
			(await getSyncStatus(env.db)).pullIssues?.some(
				(issue) => issue.unit === "personalColors",
			),
		).toBe(true);
		await syncPersonalColors();
		expect((await readColorPreferences(env.user.id)).syncError).toBe(false);
	});
	it("does not lose simultaneous category/nature changes and validates input", async () => {
		await Promise.all([
			savePersonalColor(env.user.id, {
				kind: "category",
				id: env.category.id,
				color: "#abcdef",
			}),
			savePersonalColor(env.user.id, {
				kind: "nature",
				id: env.nature.id,
				color: "#123456",
			}),
		]);
		expect(
			Object.keys((await readColorPreferences(env.user.id)).pending),
		).toHaveLength(2);
		await expect(
			savePersonalColor(env.user.id, {
				kind: "category",
				id: env.category.id,
				color: "red",
			}),
		).rejects.toThrow("Invalid personal color");
		expect(
			env.api.requests.filter((request) => request.method === "PUT"),
		).toHaveLength(0);
		expect(await env.db.mutations.count()).toBe(0);
		expect(personalColorsKey(env.user.id)).not.toBe(personalColorsKey("other"));
	});
});
