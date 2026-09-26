/// <reference types="bun" />
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { AxiosError, type AxiosResponse } from "axios";
import type { SyncOperation, SyncState } from "../src/lib/offline/types";

let state: SyncState;
const requests: string[] = [];
const payloads: unknown[] = [];
let denied = false;
let pullFailed = false;
const savedAliases: unknown[] = [];
const savedVersions: unknown[] = [];

mock.module("#imports", () => ({
	browser: {
		storage: {
			local: {
				get: async () => ({ "storylens-sync-state": structuredClone(state) }),
				set: async (value: Record<string, SyncState>) => {
					state = structuredClone(value["storylens-sync-state"]);
				},
			},
		},
	},
}));
const noop = async () => {};
mock.module("../src/lib/offline/db", () => ({
	bulkPutKeywordCategories: noop,
	bulkPutKeywordNatures: noop,
	clearKeywordDirty: noop,
	clearReplacementDirty: noop,
	replaceKeywordAliasId: noop,
	replaceKeywordCategoryId: noop,
	replaceKeywordId: noop,
	replaceKeywordNatureId: noop,
	replaceKeywordVersionId: noop,
	replaceReplacementId: noop,
	saveKeyword: noop,
	saveReplacement: noop,
	writeNovelOfflineBundle: noop,
	saveKeywordAlias: async (value: unknown) => {
		savedAliases.push(value);
	},
	saveKeywordVersion: async (value: unknown) => {
		savedVersions.push(value);
	},
}));
mock.module("../src/lib/offline/download", () => ({ downloadNovel: noop }));
mock.module("../src/lib/offline/online-status", () => ({
	isOnline: () => true,
}));
const { axiosInstance, configureApiClient } = await import(
	"../src/api/axios-instance"
);
configureApiClient("http://localhost");
axiosInstance.defaults.adapter = async (config) => {
	requests.push(`${config.method} ${config.url}`);
	if (config.data) payloads.push(JSON.parse(config.data));
	if (denied || (pullFailed && config.method === "get")) {
		throw new AxiosError("Request failed", undefined, config, undefined, {
			status: denied ? 403 : 500,
			data: {
				message: denied
					? "You can only modify resources you created"
					: "Pull failed",
			},
			config,
		} as AxiosResponse);
	}
	return {
		status: 200,
		statusText: "OK",
		headers: {},
		config,
		data:
			config.method === "get"
				? { data: [] }
				: { id: "server-id", keywordId: "keyword-id" },
	};
};
const { fullSync, syncPendingOperations } = await import(
	"../src/lib/offline/sync-engine"
);
const { getPendingOpsCount } = await import("../src/lib/offline/sync-storage");
function operation(
	entity: SyncOperation["entity"],
	action: SyncOperation["action"] = "update",
): SyncOperation {
	return {
		id: crypto.randomUUID(),
		entity,
		action,
		entityId: "entity-id",
		novelId: "novel-id",
		payload: { keywordId: "keyword-id" },
		createdAt: 0,
		status: "pending",
		retryCount: 0,
	};
}
beforeEach(() => {
	state = { pendingOps: [], lastSyncAt: 0, downloadedNovelIds: [] };
	requests.length = 0;
	payloads.length = 0;
	savedAliases.length = 0;
	savedVersions.length = 0;
	denied = false;
	pullFailed = false;
});
describe("offline sync", () => {
	it("maps a created keyword ID into dependent queued alias writes", async () => {
		const keyword = {
			...operation("keyword", "create"),
			entityId: "temp-keyword",
		};
		const alias = {
			...operation("keywordAlias", "create"),
			entityId: "temp-alias",
			payload: { keywordId: "temp-keyword", text: "Alias" },
		};
		state.pendingOps = [keyword, alias];
		expect(await syncPendingOperations()).toMatchObject({
			pushed: 2,
			remaining: 0,
		});
		expect(payloads[1]).toMatchObject({ keywordId: "server-id" });
	});
	it("keeps novels with rejected writes from overwriting local edits", async () => {
		state.pendingOps = [
			{
				...operation("keywordVersion"),
				status: "failed",
				retryCount: 5,
				lastError: "Forbidden",
				lastErrorStatus: 403,
			},
		];
		state.downloadedNovelIds = ["novel-id"];
		expect(await fullSync()).toMatchObject({
			remaining: 1,
			failed: 1,
			pulled: 0,
		});
		expect(
			requests.every(
				(request) =>
					!request.includes("/keywords/") &&
					!request.includes("/replacements/"),
			),
		).toBe(true);
	});

	it("routes aliases and versions to their own endpoints and clears the queue", async () => {
		state.pendingOps = [operation("keywordAlias"), operation("keywordVersion")];
		const result = await syncPendingOperations();
		expect(requests).toEqual([
			"put /keyword-aliases/entity-id",
			"put /keyword-versions/entity-id",
		]);
		expect(result).toMatchObject({ pushed: 2, failed: 0, remaining: 0 });
		expect(savedAliases).toHaveLength(1);
		expect(savedVersions).toHaveLength(1);
	});
	it("preserves denied writes and reports the server permission error", async () => {
		denied = true;
		state.pendingOps = [operation("keywordAlias")];
		const result = await syncPendingOperations();
		expect(result).toMatchObject({ pushed: 0, failed: 1, remaining: 1 });
		expect(result.errors[0]).toMatchObject({
			status: 403,
			message: "You can only modify resources you created",
		});
		expect(state.pendingOps[0].lastErrorStatus).toBe(403);
	});
	it("reports exhausted retries and allows explicit retry", async () => {
		state.pendingOps = [
			{
				...operation("keywordVersion"),
				status: "failed",
				retryCount: 5,
				lastError: "Forbidden",
				lastErrorStatus: 403,
			},
		];
		expect((await syncPendingOperations()).errors[0].status).toBe(403);
		expect(requests).toHaveLength(0);
		expect(await syncPendingOperations(true)).toMatchObject({
			pushed: 1,
			remaining: 0,
		});
	});
	it("counts in-flight and interrupted writes as unsynced", async () => {
		state.pendingOps = [{ ...operation("keywordAlias"), status: "syncing" }];
		expect(await getPendingOpsCount()).toBe(1);
		expect(await syncPendingOperations()).toMatchObject({
			pushed: 1,
			remaining: 0,
		});
	});
	it("coalesces concurrent pushes", async () => {
		state.pendingOps = [operation("keywordAlias")];
		const first = syncPendingOperations();
		const second = syncPendingOperations();
		expect(first).toBe(second);
		await Promise.all([first, second]);
		expect(requests).toHaveLength(1);
	});
	it("reports pull failures and does not record a successful sync", async () => {
		pullFailed = true;
		const result = await fullSync();
		expect(result.failed).toBe(1);
		expect(result.errors[0].message).toBe("Pull failed");
		expect(state.lastSyncAt).toBe(0);
	});
});
