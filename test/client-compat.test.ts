/// <reference types="bun" />
import { describe, expect, it, mock } from "bun:test";
import axios, { AxiosError, type AxiosResponse } from "axios";

let updateChecks = 0;
let reloads = 0;

mock.module("#imports", () => ({
	browser: {
		runtime: {
			getManifest: () => ({ version: "3.1.1" }),
			requestUpdateCheck: async () => {
				updateChecks += 1;
				return { status: "update_available" };
			},
			reload: () => {
				reloads += 1;
			},
		},
	},
}));

const { installClientCompat } = await import("../src/api/client-compat");

const createClient = (status: number) => {
	const sent: (string | undefined)[] = [];
	const instance = axios.create({
		adapter: async (config) => {
			sent.push(config.headers.get("X-Client-Version")?.toString());
			const response = {
				data: {},
				status,
				statusText: "",
				headers: {},
				config,
			} as AxiosResponse;
			if (status >= 400) {
				throw new AxiosError("failed", undefined, config, null, response);
			}
			return response;
		},
	});
	installClientCompat(instance);
	return { instance, sent };
};

describe("client compatibility", () => {
	it("sends the extension version on every request", async () => {
		const { instance, sent } = createClient(200);
		await instance.get("/api/user/novels");
		expect(sent).toEqual(["extension/3.1.1"]);
	});

	it("checks for an update once per hour when the API requires one", async () => {
		const { instance } = createClient(426);
		await expect(instance.get("/api/user/novels")).rejects.toThrow();
		await expect(instance.get("/api/user/novels")).rejects.toThrow();
		await Promise.resolve();

		expect(updateChecks).toBe(1);
		expect(reloads).toBe(1);
	});

	it("leaves other errors alone", async () => {
		const before = updateChecks;
		const { instance } = createClient(500);
		await expect(instance.get("/api/user/novels")).rejects.toThrow();
		expect(updateChecks).toBe(before);
	});
});
