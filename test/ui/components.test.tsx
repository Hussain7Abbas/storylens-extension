/// <reference types="bun" />
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({
	url: "chrome-extension://storylens-test/popup.html",
});

import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { makeUser, setOnline, setupEngine } from "../helpers/engine";
import { fakeBrowser } from "../helpers/fake-browser";

// webextension-polyfill (used by the messaging library) refuses to load in a page
// without an extension API; it reuses a global `browser` that has a runtime ID.
Object.assign(globalThis, {
	browser: fakeBrowser,
	chrome: { runtime: { id: fakeBrowser.runtime.id } },
});

// Count QueryClient constructions; the subclass behaves exactly like the original.
const reactQuery = await import("@tanstack/react-query");
let queryClientsCreated = 0;
class CountingQueryClient extends reactQuery.QueryClient {
	constructor(...args: ConstructorParameters<typeof reactQuery.QueryClient>) {
		super(...args);
		queryClientsCreated += 1;
	}
}
mock.module("@tanstack/react-query", () => ({
	...reactQuery,
	QueryClient: CountingQueryClient,
}));

const React = await import("react");
const { render, renderHook, fireEvent, waitFor, cleanup, act } = await import(
	"@testing-library/react"
);
const { MantineProvider } = await import("@mantine/core");
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);
const { Provider: JotaiProvider, createStore } = await import("jotai");
const { authStateAtom } = await import("../../src/lib/auth/auth-store");
const { useAuthInit } = await import("../../src/lib/auth/use-auth-init");
const { ColoringCards } = await import(
	"../../src/entrypoints/popup.home/tabs/coloring/coloring-cards"
);
const { NovelMenu } = await import("../../src/entrypoints/popup.home/home");
const { NodeSelector } = await import(
	"../../src/components/node-selector/node-selector"
);
const { useOfflineKeywords, useOfflineInvalidation } = await import(
	"../../src/lib/offline/hooks"
);
const { enqueue } = await import("../../src/lib/offline/outbox");
const { pullLookups, pullNovel } = await import(
	"../../src/lib/offline/sync/pull"
);
const { axiosInstance } = await import("../../src/api/axios-instance");
const { secondContext } = await import("../helpers/offline-db");
const { getDefaultStore } = await import("jotai");
const { localeAtom } = await import("../../src/store/locale");
const { default: App } = await import("../../src/entrypoints/popup/App");

type Env = Awaited<ReturnType<typeof setupEngine>>;
let env: Env;
let store: ReturnType<typeof createStore>;

function wrapper({ children }: { children: React.ReactNode }) {
	const client = React.useMemo(
		() => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
		[],
	);
	return React.createElement(
		JotaiProvider,
		{ store },
		React.createElement(
			MantineProvider,
			null,
			React.createElement(QueryClientProvider, { client }, children),
		),
	);
}

beforeEach(async () => {
	cleanup();
	env = await setupEngine();
	store = createStore();
	store.set(authStateAtom, { user: env.user, token: "token-reader-1" });
});

afterAll(async () => {
	cleanup();
	await GlobalRegistrator.unregister();
});

describe("per-row gating (phase 1 tests 2 and 3)", () => {
	it("opens no form for another reader's keyword but opens the reader's own alias under it", async () => {
		const theirs = env.api.seedKeyword(
			env.novel.id,
			{
				nameEn: "Theirs",
				categoryId: env.category.id,
				natureId: env.nature.id,
			},
			"someone-else",
		);
		await pullLookups({ db: env.db, token: "token-reader-1" });
		await pullNovel(env.novel.id, { db: env.db, token: "token-reader-1" });
		await enqueue(
			{
				entity: "keywordAlias",
				op: "create",
				keywordId: theirs.id,
				values: { nameEn: "My alias" },
			},
			{ db: env.db },
		);
		const edits: string[] = [];
		const view = render(
			React.createElement(ColoringCards, {
				selectedNovelId: env.novel.id,
				currentChapter: 0,
				search: "",
				onEditKeyword: (keyword) => edits.push(`keyword:${keyword.id}`),
				onEditAlias: (alias) => edits.push(`alias:${alias.nameEn}`),
			}),
			{ wrapper },
		);
		await waitFor(() => expect(view.getByText("Theirs")).toBeTruthy());
		await waitFor(() => expect(view.getByText("My alias")).toBeTruthy());
		fireEvent.click(view.getByText("Theirs"));
		fireEvent.click(view.getByText("My alias"));
		expect(edits).toEqual(["alias:My alias"]);
	});
});

describe("online-only actions offline (phase 1 test 6)", () => {
	it("disables novel actions and website selector editing without starting mutations", async () => {
		setOnline(false);
		let mode: string | undefined;
		const menu = render(
			React.createElement(NovelMenu, {
				currentTabNovel: { novelSlug: "new-slug" },
				selectedNovel: { id: env.novel.id, slugs: [] },
				setSelectedNovel: () => {},
				setMode: (value) => {
					mode = value;
				},
				refetchNovels: () => {},
				access: "moderator",
				online: false,
				t: ((key: string) => key) as never,
			}),
			{ wrapper },
		);
		fireEvent.click(menu.getByLabelText("novels.actions"));
		await waitFor(() =>
			expect(menu.getByText("offline.requiresConnection")).toBeTruthy(),
		);
		for (const label of [
			"novels.add",
			"novels.addSlug",
			"novels.edit",
			"novels.delete",
		]) {
			const item = menu.getByText(label).closest("button");
			expect(
				item?.disabled || item?.getAttribute("data-disabled") === "true",
			).toBe(true);
			if (item) fireEvent.click(item);
		}
		expect(mode).toBeUndefined();
		expect(
			env.api.requests.filter((request) => request.method !== "GET"),
		).toEqual([]);
		menu.unmount();

		// happy-dom installs its own navigator after the engine helper patched Bun's.
		Object.defineProperty(navigator, "onLine", {
			configurable: true,
			get: () => false,
		});
		const selectors = render(React.createElement(NodeSelector), { wrapper });
		const add = selectors
			.getAllByText("_.add")
			.map((node) => node.closest("button"))
			.find(Boolean) as HTMLButtonElement;
		expect(add.getAttribute("data-disabled")).toBe("true");
		fireEvent.click(add);
		expect(selectors.queryByText("nodeSelector.website")).toBeNull();
		Object.defineProperty(navigator, "onLine", {
			configurable: true,
			get: () => true,
		});
		setOnline(true);
	});
});

describe("cross-context reactivity (phase 6 test 4)", () => {
	it("updates a popup list when another context writes the database", async () => {
		await pullNovel(env.novel.id, { db: env.db, token: "token-reader-1" });
		const { result } = renderHook(
			() => {
				useOfflineInvalidation();
				return useOfflineKeywords(env.novel.id, "");
			},
			{ wrapper },
		);
		await waitFor(() => expect(result.current.isLoading).toBe(false));
		expect(result.current.items).toEqual([]);
		const background = await secondContext();
		await enqueue(
			{
				entity: "keyword",
				op: "create",
				novelId: env.novel.id,
				values: {
					nameEn: "From elsewhere",
					categoryId: env.category.id,
					natureId: env.nature.id,
				},
			},
			{ db: background },
		);
		await waitFor(
			() =>
				expect(result.current.items?.map((item) => item.nameEn)).toEqual([
					"From elsewhere",
				]),
			{ timeout: 5000 },
		);
	}, 10_000);
});

describe("stored sessions (phase 6 test 6)", () => {
	it("reloads a session stored in the old role format by its token instead of creating a guest", async () => {
		const user = makeUser("returning");
		await fakeBrowser.storage.local.set({
			"storylens-auth": JSON.stringify({
				user: {
					id: user.id,
					email: user.email,
					username: user.username,
					name: user.name,
					role: "user",
				},
				token: "old-token",
			}),
		});
		const calls: string[] = [];
		axiosInstance.defaults.adapter = async (config) => {
			calls.push(`${config.method} ${config.url}`);
			return {
				status: 200,
				statusText: "OK",
				headers: {},
				config,
				data: { ...user, role: null },
			};
		};
		const { result } = renderHook(() => useAuthInit(), { wrapper });
		await waitFor(() => expect(result.current.loading).toBe(false));
		await act(async () => {});
		expect(calls.some((call) => call.includes("/auth/me"))).toBe(true);
		expect(calls.some((call) => call.includes("/auth/guest"))).toBe(false);
		expect(store.get(authStateAtom).user?.id).toBe("returning");
	});
});

describe("popup App (phase 1 test 4)", () => {
	it("keeps one QueryClient across locale changes", async () => {
		const view = render(React.createElement(App, { type: "popup" }));
		const before = queryClientsCreated;
		await act(async () => {
			getDefaultStore().set(localeAtom, "ar");
		});
		await act(async () => {
			getDefaultStore().set(localeAtom, "en");
		});
		expect(queryClientsCreated).toBe(before);
		view.unmount();
	});
});
