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
const { ColoringTab } = await import(
	"../../src/entrypoints/popup.home/tabs/coloring/coloring-tab"
);
const { formPageAtom, PageContent } = await import(
	"../../src/components/form-page"
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
const { connectLauncherFrame, useLauncherShown, useLauncherWork } =
	await import("../../src/lib/launcher-frame/use-launcher-work");
const {
	POPUP_ANSWER_MESSAGE,
	POPUP_READY_MESSAGE,
	POPUP_REQUEST_MESSAGE,
	POPUP_SHOWN_MESSAGE,
	POPUP_STATE_MESSAGE,
} = await import("../../src/lib/launcher-frame/messages");
const { usePopupAutoSync } = await import(
	"../../src/lib/offline/use-popup-auto-sync"
);
const { loadFormValues } = await import("../../src/utils/form-baseline");
const { useForm } = await import("@mantine/form");

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

describe("edit request from a page tooltip", () => {
	/** Renders the Coloring tab with the popup's current URL. */
	async function show() {
		const view = render(
			React.createElement(
				PageContent,
				null,
				React.createElement(ColoringTab, {
					selectedNovelId: env.novel.id,
					currentChapter: 0,
				}),
			),
			{ wrapper },
		);
		// The list loads, then the requested form (if any) opens and settles.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 150));
		});
		expect(view.getByText("Theirs")).toBeTruthy();
		return view;
	}

	/** Renders the Coloring tab as the launcher opens it for an Edit button. */
	async function openWith(query: Record<string, string>) {
		const previous = window.location.href;
		window.history.replaceState(
			null,
			"",
			`?${new URLSearchParams({ ...query, novelId: env.novel.id })}`,
		);
		return {
			view: await show(),
			restore: () => window.history.replaceState(null, "", previous),
		};
	}

	async function seed() {
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
		const alias = await enqueue(
			{
				entity: "keywordAlias",
				op: "create",
				keywordId: theirs.id,
				values: { nameEn: "My alias" },
			},
			{ db: env.db },
		);
		return { theirs, aliasId: alias.entityId };
	}

	it("opens the named alias's edit form", async () => {
		const { theirs, aliasId } = await seed();
		const { view, restore } = await openWith({
			edit: "alias",
			id: aliasId,
			parentId: theirs.id,
		});
		expect(store.get(formPageAtom)).not.toBeNull();
		expect(
			view.container.querySelector<HTMLInputElement>(
				'[data-form-page] input[value="My alias"]',
			),
		).not.toBeNull();
		view.unmount();
		restore();
	});

	it("opens the form once: coming back to the Coloring tab does not reopen it", async () => {
		const { theirs, aliasId } = await seed();
		const { view, restore } = await openWith({
			edit: "alias",
			id: aliasId,
			parentId: theirs.id,
		});
		expect(store.get(formPageAtom)).not.toBeNull();
		await act(async () => {
			store.get(formPageAtom)?.close();
		});
		expect(store.get(formPageAtom)).toBeNull();
		// Settings and back: the popup keeps its URL while the tab mounts again.
		view.unmount();
		const again = await show();
		expect(store.get(formPageAtom)).toBeNull();
		// The novel the launcher named stays selected.
		expect(new URLSearchParams(window.location.search).get("novelId")).toBe(
			env.novel.id,
		);
		again.unmount();
		restore();
	});

	it("handles a create request from a text pick once too", async () => {
		await seed();
		const previous = window.location.href;
		window.history.replaceState(
			null,
			"",
			`?${new URLSearchParams({ create: "keyword", search: "Theirs", novelId: env.novel.id })}`,
		);
		// The add form replaces the list, so `show` is only used for the second mount.
		const view = render(
			React.createElement(
				PageContent,
				null,
				React.createElement(ColoringTab, {
					selectedNovelId: env.novel.id,
					currentChapter: 0,
				}),
			),
			{ wrapper },
		);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 150));
		});
		expect(store.get(formPageAtom)).not.toBeNull();
		await act(async () => {
			store.get(formPageAtom)?.close();
		});
		view.unmount();
		const again = await show();
		expect(store.get(formPageAtom)).toBeNull();
		again.unmount();
		window.history.replaceState(null, "", previous);
	});

	it("opens nothing for a row the reader may not change, or one that is gone", async () => {
		const { theirs } = await seed();
		for (const query of [
			{ edit: "keyword", id: theirs.id, parentId: theirs.id },
			{ edit: "alias", id: "missing", parentId: theirs.id },
			{ edit: "version", id: "missing", parentId: "missing" },
		]) {
			const { view, restore } = await openWith(query);
			expect(store.get(formPageAtom)).toBeNull();
			view.unmount();
			restore();
		}
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

describe("popup inside the launcher frame", () => {
	const posted: unknown[] = [];
	const launcherPage = {
		postMessage: (message: unknown) => posted.push(message),
	};
	const ownParent = Object.getOwnPropertyDescriptor(window, "parent");

	/** Puts the popup inside the launcher's iframe, or back in the toolbar popup. */
	function embed(embedded: boolean): void {
		if (embedded)
			Object.defineProperty(window, "parent", {
				configurable: true,
				value: launcherPage,
			});
		else if (ownParent) Object.defineProperty(window, "parent", ownParent);
		else Reflect.deleteProperty(window, "parent");
	}

	function receive(data: unknown, source: unknown): void {
		window.dispatchEvent(
			new MessageEvent("message", {
				data,
				source: source as MessageEventSource,
			}),
		);
	}

	type Work = Parameters<typeof useLauncherWork>[0];

	it("reports unsaved work to the launcher and clears it when the form closes", async () => {
		posted.length = 0;
		embed(true);
		try {
			const form = renderHook((work: Work) => useLauncherWork(work), {
				initialProps: { dirty: false } as Work,
			});
			await act(async () => {});
			expect(posted).toEqual([]);

			form.rerender({ dirty: true });
			await act(async () => {});
			form.rerender({ dirty: true });
			await act(async () => {});
			expect(posted).toEqual([
				{
					type: POPUP_STATE_MESSAGE,
					dirty: true,
					working: false,
					failed: false,
				},
			]);

			form.unmount();
			await act(async () => {});
			expect(posted.at(-1)).toEqual({
				type: POPUP_STATE_MESSAGE,
				dirty: false,
				working: false,
				failed: false,
			});
			expect(posted).toHaveLength(2);
		} finally {
			embed(false);
		}
	});

	it("reports nothing from the toolbar popup", async () => {
		posted.length = 0;
		const form = renderHook(() => useLauncherWork({ dirty: true }));
		await act(async () => {});
		form.unmount();
		await act(async () => {});

		expect(posted).toEqual([]);
	});

	it("hears the launcher show the kept popup, and only the launcher", () => {
		embed(true);
		try {
			let shown = 0;
			const { unmount } = renderHook(() => useLauncherShown(() => shown++));

			receive({ type: POPUP_SHOWN_MESSAGE }, launcherPage);
			expect(shown).toBe(1);

			receive({ type: POPUP_SHOWN_MESSAGE }, window);
			receive({ type: POPUP_STATE_MESSAGE }, launcherPage);
			receive(null, launcherPage);
			expect(shown).toBe(1);

			unmount();
			receive({ type: POPUP_SHOWN_MESSAGE }, launcherPage);
			expect(shown).toBe(1);
		} finally {
			embed(false);
		}
	});
	it("answers a request from its state at that moment, before any state message", () => {
		posted.length = 0;
		embed(true);
		const loaded: string[] = [];
		const disconnect = connectLauncherFrame((url) => loaded.push(url));
		try {
			expect(posted).toEqual([{ type: POPUP_READY_MESSAGE }]);
			const form = renderHook((work: Work) => useLauncherWork(work), {
				initialProps: { dirty: false } as Work,
			});
			const request = {
				type: POPUP_REQUEST_MESSAGE,
				id: "7",
				query: "create=keyword&search=Rand",
				reload: true,
			};

			// The edit is committed; its state message has not been sent yet.
			form.rerender({ dirty: true });
			posted.length = 0;
			receive(request, launcherPage);
			expect(posted).toEqual([
				{ type: POPUP_ANSWER_MESSAGE, id: "7", kept: true },
			]);
			expect(loaded).toEqual([]);

			form.unmount();
			posted.length = 0;
			receive({ ...request, id: "8" }, launcherPage);
			expect(posted).toEqual([
				{ type: POPUP_ANSWER_MESSAGE, id: "8", kept: false },
			]);
			expect(loaded).toEqual(["/popup.html?create=keyword&search=Rand"]);
		} finally {
			disconnect();
			embed(false);
		}
	});

	it("only answers when asked whether it can be removed, and ignores other senders", () => {
		embed(true);
		const loaded: string[] = [];
		const disconnect = connectLauncherFrame((url) => loaded.push(url));
		try {
			posted.length = 0;
			const request = {
				type: POPUP_REQUEST_MESSAGE,
				id: "1",
				query: "",
				reload: false,
			};
			receive(request, window);
			receive({ ...request, id: 1 }, launcherPage);
			expect(posted).toEqual([]);

			receive(request, launcherPage);
			expect(posted).toEqual([
				{ type: POPUP_ANSWER_MESSAGE, id: "1", kept: false },
			]);
			expect(loaded).toEqual([]);

			// A bare reload goes to the popup page itself, whatever the request carries.
			receive({ ...request, id: "2", reload: true }, launcherPage);
			expect(loaded).toEqual(["/popup.html"]);

			disconnect();
			posted.length = 0;
			receive({ ...request, id: "3" }, launcherPage);
			expect(posted).toEqual([]);
		} finally {
			disconnect();
			embed(false);
		}
	});

	it("does not announce itself from the toolbar popup", () => {
		posted.length = 0;
		connectLauncherFrame(() => {})();
		expect(posted).toEqual([]);
	});

	it("syncs on the launcher's shown message at most once per half minute", async () => {
		const runtime = fakeBrowser.runtime as { sendMessage: unknown };
		const original = runtime.sendMessage;
		const now = Date.now;
		let kicks = 0;
		runtime.sendMessage = async (message: unknown) => {
			if (JSON.stringify(message).includes("syncKick")) kicks += 1;
		};
		embed(true);
		try {
			const sync = renderHook(() => usePopupAutoSync(true));
			await act(async () => {});
			expect(kicks).toBe(1);

			// The novel page can send this message too, as often as it likes.
			for (let count = 0; count < 5; count += 1)
				receive({ type: POPUP_SHOWN_MESSAGE }, launcherPage);
			await act(async () => {});
			expect(kicks).toBe(1);

			const later = now() + 31_000;
			Date.now = () => later;
			receive({ type: POPUP_SHOWN_MESSAGE }, launcherPage);
			receive({ type: POPUP_SHOWN_MESSAGE }, launcherPage);
			await act(async () => {});
			expect(kicks).toBe(2);
			sync.unmount();
		} finally {
			Date.now = now;
			runtime.sendMessage = original;
			embed(false);
		}
	});
});

describe("values a form loads by itself", () => {
	const initialValues = { name: "", description: "" };

	it("become the baseline of a form the reader has not edited", () => {
		const { result } = renderHook(() => useForm({ initialValues }));
		act(() =>
			loadFormValues(result.current, () =>
				result.current.setValues({ name: "Detected", description: "" }),
			),
		);

		expect(result.current.values.name).toBe("Detected");
		expect(result.current.isDirty()).toBe(false);

		act(() => result.current.setFieldValue("description", "typed"));
		expect(result.current.isDirty()).toBe(true);
	});

	it("leave the reader's earlier edits marked as unsaved", () => {
		const { result } = renderHook(() => useForm({ initialValues }));
		act(() => result.current.setFieldValue("description", "typed"));

		// The detected name arrives late and must not take over a typed field.
		act(() =>
			loadFormValues(result.current, () => {
				if (!result.current.isDirty("name"))
					result.current.setFieldValue("name", "Detected");
			}),
		);
		expect(result.current.values).toEqual({
			name: "Detected",
			description: "typed",
		});
		expect(result.current.isDirty()).toBe(true);

		act(() => result.current.setFieldValue("name", "Mine"));
		act(() =>
			loadFormValues(result.current, () => {
				if (!result.current.isDirty("name"))
					result.current.setFieldValue("name", "Detected again");
			}),
		);
		expect(result.current.values.name).toBe("Mine");
		expect(result.current.isDirty()).toBe(true);
	});

	it("keep a late whole-form load from marking the reader's form clean", () => {
		const { result } = renderHook(() => useForm({ initialValues }));
		act(() => result.current.setFieldValue("name", "typed"));
		act(() =>
			loadFormValues(result.current, () =>
				result.current.setValues({ name: "Saved", description: "Saved" }),
			),
		);

		expect(result.current.isDirty()).toBe(true);
	});
});
