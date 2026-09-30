/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { setupEngine } from "../helpers/engine";
import { fakeBrowser } from "../helpers/fake-browser";

const { axiosInstance } = await import("../../src/api/axios-instance");

const auth = (token: string) => ({
	headers: { Authorization: `Bearer ${token}` },
});

describe("test harness", () => {
	it("refuses non-UUID IDs and stale bases, and bumps updatedAt on every write", async () => {
		const { api, novel, category, nature } = await setupEngine();
		const bad = await axiosInstance
			.post(
				"/api/user/keywords/",
				{
					id: "temp-1",
					versionId: crypto.randomUUID(),
					nameEn: "X",
					novelId: novel.id,
					categoryId: category.id,
					natureId: nature.id,
				},
				auth("token-reader-1"),
			)
			.catch((error) => error.response.status);
		expect(bad).toBe(422);
		const id = crypto.randomUUID();
		const created = await axiosInstance.post(
			"/api/user/keywords/",
			{
				id,
				versionId: crypto.randomUUID(),
				nameEn: "K",
				novelId: novel.id,
				categoryId: category.id,
				natureId: nature.id,
			},
			auth("token-reader-1"),
		);
		const first = await axiosInstance.put(
			`/api/user/keywords/${id}`,
			{ baseUpdatedAt: created.data.updatedAt, matchingType: "PARTIAL" },
			auth("token-reader-1"),
		);
		expect(first.data.updatedAt).not.toBe(created.data.updatedAt);
		const stale = await axiosInstance
			.put(
				`/api/user/keywords/${id}`,
				{ baseUpdatedAt: created.data.updatedAt, nameEn: "K2" },
				auth("token-reader-1"),
			)
			.catch((error) => error.response);
		expect([stale.status, stale.data.code, stale.data.current.id]).toEqual([
			409,
			"STALE_WRITE",
			id,
		]);
		expect(api.requests.length).toBe(4);
	});

	it("interleaves concurrent storage calls", async () => {
		await setupEngine();
		const order: string[] = [];
		await Promise.all([
			fakeBrowser.storage.local.get("a").then(() => order.push("get")),
			fakeBrowser.storage.local.set({ a: 1 }).then(() => order.push("set")),
		]);
		expect(order).toEqual(["get", "set"]);
		expect(await fakeBrowser.storage.local.get("a")).toEqual({ a: 1 });
	});
});
