/// <reference types="bun" />
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({
	url: "chrome-extension://storylens-test/popup.html",
});

import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import { makeUser, setOnline, setupEngine } from "../helpers/engine";
import { fakeBrowser } from "../helpers/fake-browser";

// webextension-polyfill (used by the messaging library) refuses to load in a page
// without an extension API; it reuses a global `browser` that has a runtime ID.
Object.assign(globalThis, {
	browser: fakeBrowser,
	chrome: { runtime: { id: fakeBrowser.runtime.id } },
});

// The DOM tests need a logo URL, not WXT's binary asset loader.
mock.module("@/assets/icon.png", () => ({ default: "/icons/128.png" }));

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
const { render, renderHook, fireEvent, waitFor, cleanup, act, configure } =
	await import("@testing-library/react");
// Allow slower rendering while browser build checks run on the same machine.
configure({ asyncUtilTimeout: 5000 });

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
const { useAiTask } = await import("../../src/lib/launcher-frame/use-ai-task");
const { useAiConfigured } = await import(
	"../../src/lib/desktop-client/use-ai-configured"
);
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
const { AppearanceTab } = await import(
	"../../src/entrypoints/popup.settings/appearance-tab"
);
const { NIGHT_LIGHT_LEVEL_KEY } = await import("../../src/lib/night-light");
const {
	APPEARANCE_FONT_SIZE_KEY,
	fontSizeAtom,
	nightLightLevelAtom,
	showWordVfxAtom,
	tooltipTriggerAtom,
} = await import("../../src/store/appearance");
const { TOOLTIP_TRIGGER_KEY } = await import("../../src/lib/tooltip-trigger");
const { SHOW_WORD_VFX_KEY } = await import("../../src/lib/keyword-effects");

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

describe("list thumbnails", () => {
	it("shows a version's image on rows that have none of their own", async () => {
		const image = {
			id: "image-1",
			url: "https://images.example.invalid/later.png",
			type: "Image",
			provider_image_id: "image-1",
			delete_url: "https://images.example.invalid/delete/later",
			userId: null,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		};
		const mine = env.api.seedKeyword(
			env.novel.id,
			{
				nameEn: "Mira",
				categoryId: env.category.id,
				natureId: env.nature.id,
			},
			env.user.id,
		);
		env.api.seedAlias(mine.id, { nameEn: "The Sword" });
		// Only a later version carries an image; the rows being read have none.
		env.api.files.set(image.id, image);
		env.api.seedVersion(mine.id, { startingChapter: 10, imageId: image.id });
		await pullLookups({ db: env.db, token: "token-reader-1" });
		await pullNovel(env.novel.id, { db: env.db, token: "token-reader-1" });

		const view = render(
			React.createElement(ColoringCards, {
				selectedNovelId: env.novel.id,
				currentChapter: 0,
				search: "",
				onEditKeyword: () => {},
				onEditAlias: () => {},
			}),
			{ wrapper },
		);
		await waitFor(() => expect(view.getByText("Mira")).toBeTruthy());

		const images = [
			...view.container.querySelectorAll<HTMLImageElement>("img"),
		].filter((element) => element.src === image.url);
		// The keyword, its alias and both versions all show the one image.
		expect(images).toHaveLength(4);
		// The version that owns it is the only row showing it undimmed.
		expect(
			images.filter((element) => element.style.opacity === "1"),
		).toHaveLength(1);
		view.unmount();
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
		await waitFor(() => expect(view.getByText("Theirs")).toBeTruthy());
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

	it("drops the image request from the URL so a remount does not repeat it", async () => {
		const mine = env.api.seedKeyword(
			env.novel.id,
			{
				nameEn: "Mine",
				categoryId: env.category.id,
				natureId: env.nature.id,
			},
			env.user.id,
		);
		await pullLookups({ db: env.db, token: "token-reader-1" });
		await pullNovel(env.novel.id, { db: env.db, token: "token-reader-1" });
		const previous = window.location.href;
		window.history.replaceState(
			null,
			"",
			`?${new URLSearchParams({
				edit: "keyword",
				id: mine.id,
				parentId: mine.id,
				generate: "image",
				novelId: env.novel.id,
			})}`,
		);
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
		expect(new URLSearchParams(window.location.search).has("generate")).toBe(
			false,
		);
		view.unmount();
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
	it("mirrors tooltip trigger changes to extension storage", async () => {
		const view = render(React.createElement(App, { type: "popup" }));
		await waitFor(() =>
			expect(fakeBrowser.storage.local.peek(TOOLTIP_TRIGGER_KEY)).toBe("click"),
		);
		await act(async () => {
			getDefaultStore().set(tooltipTriggerAtom, "hover");
		});
		await waitFor(() =>
			expect(fakeBrowser.storage.local.peek(TOOLTIP_TRIGGER_KEY)).toBe("hover"),
		);
		await act(async () => {
			getDefaultStore().set(tooltipTriggerAtom, "click");
		});
		view.unmount();
	});

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
			// The key labels this document's AI tasks on its launcher tab.
			expect(posted).toEqual([
				{ type: POPUP_READY_MESSAGE, key: expect.any(String) },
			]);
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

	describe("AI tasks listed under the launcher", () => {
		type Task = Parameters<typeof useAiTask>[0];
		const runtime = fakeBrowser.runtime as { sendMessage: unknown };
		let original: unknown;
		let reports: Record<string, unknown>[] = [];

		beforeEach(() => {
			reports = [];
			original = runtime.sendMessage;
			runtime.sendMessage = async (message: unknown) => {
				const { type, data } = message as {
					type: string;
					data: Record<string, unknown>;
				};
				if (type === "reportAiTask") reports.push(data);
			};
			embed(true);
			// This document is the launcher's kept popup.
			connectLauncherFrame(() => {})();
		});

		afterEach(() => {
			runtime.sendMessage = original;
			embed(false);
		});

		const states = () =>
			reports.map(
				(report) => `${report.state}:${String(report.id).slice(0, 4)}`,
			);
		const task = (props: Partial<Task> = {}): Task => ({
			operation: "generate-image",
			subject: "Rand",
			working: false,
			...props,
		});

		for (const action of ["cancel", "save"] as const)
			it(`releases a keyword suggestion after ${action} while its Coloring tab stays mounted`, async () => {
				const previousUrl = window.location.href;
				await pullLookups({ db: env.db, token: "token-reader-1" });
				await pullNovel(env.novel.id, { db: env.db, token: "token-reader-1" });
				await fakeBrowser.storage.local.set({
					"storylens-desktop-client": {
						port: 43127,
						token: "paired",
						model: "test-model",
						effort: "low",
					},
				});
				// App normally loads the shared AI settings before rendering the tab.
				const configured = renderHook(() => useAiConfigured(), { wrapper });
				await waitFor(() => expect(configured.result.current).toBe(true));
				configured.unmount();
				runtime.sendMessage = async (message: unknown) => {
					const { type, data } = message as {
						type: string;
						data: Record<string, unknown>;
					};
					if (type === "reportAiTask") reports.push(data);
					if (type === "executeAiPrompt")
						return {
							res: {
								ok: true,
								value: data.webSearch
									? "A fantasy novel."
									: JSON.stringify({
											description: "A shepherd.",
											category: 1,
											nature: 1,
										}),
							},
						};
					return { res: undefined };
				};
				window.history.replaceState(
					null,
					"",
					`?${new URLSearchParams({
						create: "keyword",
						search: "Rand",
						aiContext: JSON.stringify({ before: "", after: "" }),
					})}`,
				);
				posted.length = 0;
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
				try {
					await waitFor(() => {
						expect(view.getByRole("button", { name: "_.save" })).toBeTruthy();
						expect(view.getByDisplayValue("A shepherd.")).toBeTruthy();
						expect(reports.at(-1)).toMatchObject({ state: "done" });
						expect(posted.at(-1)).toMatchObject({ dirty: true });
					});
					const button = view.getByRole("button", { name: `_.${action}` });
					if (action === "save") {
						fireEvent.click(
							view.getByLabelText(/^coloring.category/, { selector: "input" }),
						);
						fireEvent.click(
							view.getByRole("option", { name: "Hero", hidden: true }),
						);
						fireEvent.click(
							view.getByLabelText(/^coloring.nature/, { selector: "input" }),
						);
						fireEvent.click(
							view.getByRole("option", { name: "Human", hidden: true }),
						);
						const form = button.closest("form");
						if (!form) throw new Error("the keyword form is missing");
						fireEvent.submit(form);
					} else fireEvent.click(button);
					await waitFor(() => {
						expect(store.get(formPageAtom)).toBeNull();
						expect(view.getByRole("button", { name: "_.add" })).toBeTruthy();
						expect(reports.at(-1)).toMatchObject({ state: "released" });
						expect(posted.at(-1)).toMatchObject({ dirty: false });
					});
					expect(await env.db.mutations.count()).toBe(
						action === "save" ? 1 : 0,
					);
					expect(view.queryByText("coloring.aiSuggestionReady")).toBeNull();
				} finally {
					view.unmount();
					window.history.replaceState(null, "", previousUrl);
				}
			});

		it("reports a request from start to done and releases it when the form closes", async () => {
			const hook = renderHook((props: Task) => useAiTask(props), {
				initialProps: task(),
			});
			await act(async () => {});
			expect(reports).toEqual([]);

			hook.rerender(task({ working: true }));
			await act(async () => {});
			// The subject is read when the request starts.
			hook.rerender(task({ working: true, subject: "Renamed" }));
			hook.rerender(task({ working: false, subject: "Renamed" }));
			await act(async () => {});
			expect(
				reports.map(({ state, subject, operation, source }) => ({
					state,
					subject,
					operation,
					source,
				})),
			).toEqual([
				{
					state: "working",
					subject: "Rand",
					operation: "generate-image",
					source: "popup",
				},
				{
					state: "done",
					subject: "Rand",
					operation: "generate-image",
					source: "popup",
				},
			]);
			expect(reports[0]?.id).toBe(reports[1]?.id);

			// Every report names this popup document, so the launcher shows it on its tab.
			expect(reports[0]?.frame).toEqual(expect.any(String));
			hook.unmount();
			await act(async () => {});
			expect(reports.at(-1)).toEqual({
				id: reports[0]?.id,
				state: "released",
				source: "popup",
				frame: reports[0]?.frame,
			});
		});

		it("counts a result it holds as unsaved work in the popup", async () => {
			posted.length = 0;
			const hook = renderHook((props: Task) => useAiTask(props), {
				initialProps: task({ working: true }),
			});
			hook.rerender(task());
			await act(async () => {});
			// The launcher keeps this tab and opens the next form in a new one.
			expect(posted.at(-1)).toMatchObject({
				type: POPUP_STATE_MESSAGE,
				dirty: true,
			});

			hook.rerender(task({ holding: false }));
			await act(async () => {});
			expect(posted.at(-1)).toMatchObject({
				type: POPUP_STATE_MESSAGE,
				dirty: false,
			});
			hook.unmount();
		});

		it("holds nothing for a failed request", async () => {
			posted.length = 0;
			const hook = renderHook((props: Task) => useAiTask(props), {
				initialProps: task({ working: true }),
			});
			hook.rerender(task({ failed: true }));
			await act(async () => {});
			expect(
				posted.filter(
					(message) =>
						(message as { type?: string }).type === POPUP_STATE_MESSAGE,
				),
			).toEqual([]);
			expect(reports.map((report) => report.state)).toEqual([
				"working",
				"failed",
				"released",
			]);
			hook.unmount();
		});

		it("reports a failure and releases the previous result when a new request starts", async () => {
			const hook = renderHook((props: Task) => useAiTask(props), {
				initialProps: task({ working: true }),
			});
			hook.rerender(task({ failed: true }));
			hook.rerender(task({ working: true }));
			hook.rerender(task());
			await act(async () => {});
			const [first, second] = [reports[0]?.id, reports[3]?.id];
			expect(reports.map((report) => [report.id, report.state])).toEqual([
				[first, "working"],
				[first, "failed"],
				[first, "released"],
				[second, "working"],
				[second, "done"],
			]);
			expect(first).not.toBe(second);
			hook.unmount();
		});

		it("cancels a running request when its component goes away", async () => {
			const hook = renderHook((props: Task) => useAiTask(props), {
				initialProps: task({ working: true }),
			});
			hook.unmount();
			await act(async () => {});
			expect(states()).toEqual([
				`working:${String(reports[0]?.id).slice(0, 4)}`,
				`released:${String(reports[0]?.id).slice(0, 4)}`,
			]);
		});

		it("releases a result once nothing is held, at once or later", async () => {
			const hook = renderHook((props: Task) => useAiTask(props), {
				initialProps: task({ working: true, holding: false }),
			});
			hook.rerender(task({ holding: false }));
			await act(async () => {});
			expect(reports.map((report) => report.state)).toEqual([
				"working",
				"done",
				"released",
			]);

			hook.rerender(task({ working: true }));
			hook.rerender(task({ holding: true }));
			hook.rerender(task({ holding: false }));
			await act(async () => {});
			expect(reports.map((report) => report.state)).toEqual([
				"working",
				"done",
				"released",
				"working",
				"done",
				"released",
			]);
			hook.unmount();
			await act(async () => {});
			expect(reports).toHaveLength(6);
		});

		it("reports nothing from the toolbar popup", async () => {
			embed(false);
			const hook = renderHook((props: Task) => useAiTask(props), {
				initialProps: task({ working: true }),
			});
			hook.rerender(task());
			hook.unmount();
			await act(async () => {});
			expect(reports).toEqual([]);
		});
	});
});

describe("language tabs in a character form", () => {
	/** Opens the keyword form the text picker would open, without AI. */
	async function openKeywordForm(
		search: string,
		kind: "keyword" | "alias" = "keyword",
		parentId?: string,
		editId?: string,
		generateImage = false,
	) {
		await pullLookups({ db: env.db, token: "token-reader-1" });
		await pullNovel(env.novel.id, { db: env.db, token: "token-reader-1" });
		window.history.replaceState(
			null,
			"",
			`?${new URLSearchParams({
				...(editId ? { edit: kind, id: editId } : { create: kind }),
				search,
				...(parentId ? { parentId } : {}),
				...(generateImage ? { generate: "image" } : {}),
			})}`,
		);
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
		await waitFor(() =>
			expect(view.getByRole("button", { name: "_.save" })).toBeTruthy(),
		);
		return view;
	}

	const nameInput = (view: ReturnType<typeof render>) =>
		view.getByLabelText("coloring.name", {
			selector: "input",
		}) as HTMLInputElement;

	/** Picks the category and nature, which the form requires. */
	const chooseStyles = async (view: ReturnType<typeof render>) => {
		fireEvent.click(
			view.getByLabelText(/^coloring.category/, { selector: "input" }),
		);
		fireEvent.click(
			await view.findByRole("option", { name: "Hero", hidden: true }),
		);
		fireEvent.click(
			view.getByLabelText(/^coloring.nature/, { selector: "input" }),
		);
		fireEvent.click(
			await view.findByRole("option", { name: "Human", hidden: true }),
		);
	};

	it("keeps Advance collapsed with legacy defaults, validates bounds and saves the initial range", async () => {
		const view = await openKeywordForm("Mira");
		await chooseStyles(view);
		const section = view.getByText("coloring.advance").closest("details");
		expect(section?.open).toBe(false);
		const start = view.getByLabelText(
			"coloring.startingChapter",
		) as HTMLInputElement;
		const end = view.getByLabelText(
			"coloring.endingChapter",
		) as HTMLInputElement;
		expect(start.value).toBe("0");
		expect(end.value).toBe("");
		if (section) section.open = true;
		fireEvent.change(start, { target: { value: "12" } });
		fireEvent.change(end, { target: { value: "11" } });
		if (section) section.open = false;
		const form = view.getByRole("button", { name: "_.save" }).closest("form");
		if (!form) throw new Error("keyword form missing");
		setOnline(false);
		fireEvent.submit(form);
		await waitFor(() =>
			expect(view.getByText("coloring.invalidRange")).toBeTruthy(),
		);
		expect(section?.open).toBe(true);
		expect(await env.db.mutations.count()).toBe(0);
		fireEvent.change(end, { target: { value: "24" } });
		fireEvent.submit(form);
		await waitFor(async () => expect(await env.db.mutations.count()).toBe(1));
		expect((await env.db.mutations.toArray())[0]?.patch).toMatchObject({
			startingChapter: 12,
			endingChapter: 24,
		});
	});

	for (const kind of ["keyword", "alias"] as const) {
		for (const mode of ["add", "edit"] as const) {
			it(`saves independent Word VFX from collapsed Advance on ${kind} ${mode}`, async () => {
				const parent = env.api.seedKeyword(
					env.novel.id,
					{
						nameEn: "Mira",
						categoryId: env.category.id,
						natureId: env.nature.id,
						wordVfx: "HEAT",
					},
					env.user.id,
				);
				const alias = env.api.seedAlias(parent.id, {
					nameEn: "The Sword",
					wordVfx: "SHAKING",
					createdById: env.user.id,
				});
				const view = await openKeywordForm(
					kind === "keyword" ? "New character" : "New alias",
					kind,
					kind === "alias" || mode === "edit" ? parent.id : undefined,
					mode === "edit"
						? kind === "keyword"
							? parent.id
							: alias.id
						: undefined,
				);
				if (kind === "keyword" && mode === "add") await chooseStyles(view);
				const section = view.getByText("coloring.advance").closest("details");
				expect(section?.open).toBe(false);
				const input = view.getByLabelText("coloring.wordVfx", {
					selector: "input",
				}) as HTMLInputElement;
				expect(section?.contains(input)).toBe(true);
				expect(input.value).toBe(
					mode === "add"
						? "settings.effects.NONE"
						: kind === "keyword"
							? "settings.effects.HEAT"
							: "settings.effects.SHAKING",
				);
				if (section) section.open = true;
				fireEvent.click(input);
				const options = await view.findAllByRole("option", { hidden: true });
				expect(
					options.filter((option) =>
						option.textContent?.startsWith("settings.effects."),
					),
				).toHaveLength(5);
				fireEvent.click(
					view.getByRole("option", {
						name: "settings.effects.SPARKLES",
						hidden: true,
					}),
				);
				const color = view.getByLabelText("coloring.wordVfxColor", {
					selector: "input",
				}) as HTMLInputElement;
				expect(color.value).toBe("");
				fireEvent.change(color, { target: { value: "#A1b2C3" } });
				const form = view
					.getByRole("button", { name: "_.save" })
					.closest("form");
				if (!form) throw new Error("form missing");
				setOnline(false);
				fireEvent.submit(form);
				await waitFor(async () =>
					expect(await env.db.mutations.count()).toBe(1),
				);
				const mutation = (await env.db.mutations.toArray())[0];
				expect(mutation?.entity).toBe(
					kind === "keyword" ? "keyword" : "keywordAlias",
				);
				expect(mutation?.patch.wordVfx).toBe("SPARKLES");
				expect(mutation?.patch.wordVfxColor).toBe("#A1b2C3");
			});
		}
	}

	for (const kind of ["keyword", "alias"] as const) {
		it(`clears a saved ${kind} VFX color back to inheritance`, async () => {
			const parent = env.api.seedKeyword(
				env.novel.id,
				{
					nameEn: "Mira",
					categoryId: env.category.id,
					natureId: env.nature.id,
					wordVfx: "SPARKLES",
					wordVfxColor: "#123456",
				},
				env.user.id,
			);
			const alias = env.api.seedAlias(parent.id, {
				nameEn: "The Sword",
				wordVfx: "HEAT",
				wordVfxColor: "#abcdef",
				createdById: env.user.id,
			});
			const view = await openKeywordForm(
				"",
				kind,
				parent.id,
				kind === "keyword" ? parent.id : alias.id,
			);
			const section = view.getByText("coloring.advance").closest("details");
			if (section) section.open = true;
			const color = view.getByLabelText("coloring.wordVfxColor", {
				selector: "input",
			}) as HTMLInputElement;
			expect(color.value).toBe(kind === "keyword" ? "#123456" : "#abcdef");
			const form = view.getByRole("button", { name: "_.save" }).closest("form");
			if (!form) throw new Error("form missing");
			fireEvent.change(color, { target: { value: "invalid" } });
			setOnline(false);
			fireEvent.submit(form);
			await waitFor(() =>
				expect(view.getByText("settings.invalidColor")).toBeTruthy(),
			);
			expect(await env.db.mutations.count()).toBe(0);
			fireEvent.click(
				view.getByRole("button", { name: "coloring.inheritWordColor" }),
			);
			expect(color.value).toBe("");
			fireEvent.submit(form);
			await waitFor(async () => expect(await env.db.mutations.count()).toBe(1));
			expect((await env.db.mutations.toArray())[0]?.patch).toEqual({
				wordVfxColor: null,
			});
		});
	}

	it("starts a hover image request once when the source becomes ready", async () => {
		const previousUrl = window.location.href;
		const runtime = fakeBrowser.runtime as { sendMessage: unknown };
		const original = runtime.sendMessage;
		const parent = env.api.seedKeyword(
			env.novel.id,
			{
				nameEn: "Mira",
				nameAr: "ميرا",
				categoryId: env.category.id,
				natureId: env.nature.id,
			},
			env.user.id,
		);
		let finishImage: (value: unknown) => void = () => {};
		const imageReply = new Promise<unknown>((resolve) => {
			finishImage = resolve;
		});
		const imageRequests: { prompt?: string }[] = [];
		runtime.sendMessage = async (message: unknown) => {
			const item = message as { type: string; data?: { prompt?: string } };
			if (item.type === "generateAiImage") {
				imageRequests.push(item.data ?? {});
				return imageReply;
			}
			if (item.type === "executeAiPrompt")
				return { res: { ok: true, value: "A fantasy novel." } };
			return { res: undefined };
		};
		let view: ReturnType<typeof render> | undefined;
		try {
			view = await openKeywordForm("", "keyword", parent.id, parent.id, true);
			const generate = view.getByRole("button", {
				name: /coloring.generateImage$/,
			});
			expect(generate.hasAttribute("data-disabled")).toBe(false);
			await waitFor(() =>
				expect(
					view?.getByRole("button", { name: "coloring.copyImagePrompt" }),
				).toBeTruthy(),
			);
			expect(imageRequests).toHaveLength(0);
			expect(new URLSearchParams(window.location.search).has("generate")).toBe(
				false,
			);
			await fakeBrowser.storage.local.set({
				"storylens-desktop-client": {
					token: "paired",
					model: "test-model",
					effort: "low",
				},
			});
			await waitFor(() => expect(imageRequests).toHaveLength(1));
			expect(imageRequests[0].prompt).toContain("Entity: Mira");
			fireEvent.click(view.getByRole("tab", { name: "coloring.arabic" }));
			finishImage({
				res: { ok: true, value: { data: "AA==", mimeType: "image/png" } },
			});
			await waitFor(() =>
				expect(view?.getByAltText("coloring.imagePreview")).toBeTruthy(),
			);
			fireEvent.click(view.getByRole("tab", { name: "coloring.english" }));
			expect(imageRequests).toHaveLength(1);
		} finally {
			finishImage({ res: undefined });
			view?.unmount();
			runtime.sendMessage = original;
			window.history.replaceState(null, "", previousUrl);
		}
	});

	for (const kind of ["keyword", "alias"] as const) {
		it(`keeps ${kind} image generation running when its language tab changes`, async () => {
			const previousUrl = window.location.href;
			const runtime = fakeBrowser.runtime as { sendMessage: unknown };
			const original = runtime.sendMessage;
			const parent = env.api.seedKeyword(
				env.novel.id,
				{
					nameEn: "Parent",
					categoryId: env.category.id,
					natureId: env.nature.id,
				},
				env.user.id,
			);
			await fakeBrowser.storage.local.set({
				"storylens-desktop-client": {
					token: "paired",
					model: "test-model",
					effort: "low",
				},
			});
			let finishImage: (value: unknown) => void = () => {};
			const imageReply = new Promise<unknown>((resolve) => {
				finishImage = resolve;
			});
			const requests: { type: string; data?: { prompt?: string } }[] = [];
			runtime.sendMessage = async (message: unknown) => {
				const item = message as { type: string; data?: { prompt?: string } };
				requests.push(item);
				if (item.type === "generateAiImage") return imageReply;
				if (item.type === "executeAiPrompt")
					return { res: { ok: true, value: "A fantasy novel." } };
				return { res: undefined };
			};
			const view = await openKeywordForm("", kind, parent.id);
			try {
				fireEvent.click(view.getByRole("tab", { name: "coloring.arabic" }));
				fireEvent.change(nameInput(view), { target: { value: "ليو" } });
				const generate = view.getByRole("button", {
					name: /coloring.generateImage$/,
				});
				await waitFor(() =>
					expect(generate.hasAttribute("data-disabled")).toBe(false),
				);
				fireEvent.click(generate);
				await waitFor(() =>
					expect(requests.some((item) => item.type === "generateAiImage")).toBe(
						true,
					),
				);
				expect(
					requests.find((item) => item.type === "generateAiImage")?.data
						?.prompt,
				).toContain("Entity: ليو");
				fireEvent.click(view.getByRole("tab", { name: "coloring.english" }));
				expect(view.getByText("coloring.generatingImage")).toBeTruthy();
				expect(requests.some((item) => item.type === "cancelAiPrompt")).toBe(
					false,
				);
				finishImage({
					res: { ok: true, value: { data: "AA==", mimeType: "image/png" } },
				});
				await waitFor(() =>
					expect(view.getByAltText("coloring.imagePreview")).toBeTruthy(),
				);
				await waitFor(() =>
					expect(
						(view.getByRole("button", { name: "_.save" }) as HTMLButtonElement)
							.disabled,
					).toBe(false),
				);
				fireEvent.click(view.getByRole("tab", { name: "coloring.arabic" }));
				expect(nameInput(view).value).toBe("ليو");
				expect(view.getByAltText("coloring.imagePreview")).toBeTruthy();
			} finally {
				finishImage({ res: undefined });
				view.unmount();
				runtime.sendMessage = original;
				window.history.replaceState(null, "", previousUrl);
			}
		});

		it(`offers no conflicting link for a bilingual ${kind}`, async () => {
			const parent = env.api.seedKeyword(
				env.novel.id,
				{
					nameEn: "Parent",
					nameAr: kind === "keyword" ? "الأصل" : null,
					categoryId: env.category.id,
					natureId: env.nature.id,
				},
				env.user.id,
			);
			let targetId = parent.id;
			if (kind === "keyword") {
				env.api.seedKeyword(
					env.novel.id,
					{
						nameAr: "ليو",
						nameEn: null,
						categoryId: env.category.id,
						natureId: env.nature.id,
					},
					env.user.id,
				);
			} else {
				const target = env.api.seedAlias(parent.id, {
					nameEn: "Leo",
					nameAr: "ليو",
					createdById: env.user.id,
				});
				targetId = target.id;
				env.api.seedAlias(parent.id, {
					nameAr: "الفانوس",
					nameEn: null,
					createdById: env.user.id,
				});
			}
			const previousUrl = window.location.href;
			const view = await openKeywordForm("", kind, parent.id, targetId);
			try {
				fireEvent.click(view.getByRole("tab", { name: "coloring.arabic" }));
				fireEvent.click(
					view.getByLabelText("coloring.link", { selector: "input" }),
				);
				await waitFor(() =>
					expect(view.getByText("coloring.noLinks")).toBeTruthy(),
				);
				expect(
					view.queryByRole("option", {
						name: kind === "keyword" ? "ليو" : "الفانوس",
						hidden: true,
					}),
				).toBeNull();
			} finally {
				view.unmount();
				window.history.replaceState(null, "", previousUrl);
			}
		});
	}

	it("saves one name per tab and offers Link only in the other language's tab", async () => {
		// Named in Arabic only: the kind of row the English reader's Link offers.
		const arabic = env.api.seedKeyword(
			env.novel.id,
			{
				nameAr: "ليو",
				nameEn: null,
				categoryId: env.category.id,
				natureId: env.nature.id,
			},
			env.user.id,
		);
		const view = await openKeywordForm("Leo");
		const previousUrl = window.location.href;
		try {
			// The reader's own tab opens first, with the picked text and no Link.
			expect(nameInput(view).value).toBe("Leo");
			expect(
				view.queryByLabelText("coloring.link", { selector: "input" }),
			).toBeNull();

			fireEvent.click(view.getByRole("tab", { name: "coloring.arabic" }));
			await waitFor(() => expect(nameInput(view).value).toBe(""));
			const link = view.getByLabelText("coloring.link", { selector: "input" });

			fireEvent.click(link);
			fireEvent.click(
				await view.findByRole("option", { name: "ليو", hidden: true }),
			);

			// The link fills that tab's name, which then belongs to the linked keyword.
			await waitFor(() => expect(nameInput(view).value).toBe("ليو"));
			expect(nameInput(view).disabled).toBe(true);

			await chooseStyles(view);
			const form = view.getByRole("button", { name: "_.save" }).closest("form");
			if (!form) throw new Error("the keyword form is missing");
			fireEvent.submit(form);

			await waitFor(async () => expect(await env.db.mutations.count()).toBe(1));
			const [mutation] = await env.db.mutations.toArray();
			// The linked keyword still holds that name until the merge moves it, so the
			// form sends the link rather than the name it is showing.
			expect(mutation?.patch).toMatchObject({
				nameEn: "Leo",
				nameAr: null,
				translationKeywordId: arabic.id,
			});
		} finally {
			view.unmount();
			window.history.replaceState(null, "", previousUrl);
		}
	});

	it("asks for a name a link cannot provide", async () => {
		const arabic = env.api.seedKeyword(
			env.novel.id,
			{
				nameAr: "ليو",
				nameEn: null,
				categoryId: env.category.id,
				natureId: env.nature.id,
			},
			env.user.id,
		);
		expect(arabic.id).toBeTruthy();
		const view = await openKeywordForm("Leo");
		const previousUrl = window.location.href;
		try {
			// Clearing the reader's own name leaves the link as the only one, which the
			// API never receives, so the form asks for one instead of failing on save.
			fireEvent.change(nameInput(view), { target: { value: "" } });
			fireEvent.click(view.getByRole("tab", { name: "coloring.arabic" }));
			fireEvent.click(
				view.getByLabelText("coloring.link", { selector: "input" }),
			);
			fireEvent.click(
				await view.findByRole("option", { name: "ليو", hidden: true }),
			);
			await chooseStyles(view);
			const form = view.getByRole("button", { name: "_.save" }).closest("form");
			if (!form) throw new Error("the keyword form is missing");
			fireEvent.submit(form);

			await waitFor(() =>
				expect(view.queryAllByText("home.nameRequired").length).toBeGreaterThan(
					0,
				),
			);
			expect(await env.db.mutations.count()).toBe(0);
		} finally {
			view.unmount();
			window.history.replaceState(null, "", previousUrl);
		}
	});

	for (const kind of ["keyword", "alias"] as const) {
		it(`saves independent descriptions from both ${kind} language tabs`, async () => {
			const parent = env.api.seedKeyword(
				env.novel.id,
				{
					nameEn: "Parent",
					categoryId: env.category.id,
					natureId: env.nature.id,
				},
				env.user.id,
			);
			const view = await openKeywordForm(
				"Mira",
				kind,
				kind === "alias" ? parent.id : undefined,
			);
			try {
				const description = () =>
					view.getByLabelText("coloring.description", {
						selector: "input",
					}) as HTMLInputElement;
				fireEvent.change(description(), {
					target: { value: "English description" },
				});
				fireEvent.click(view.getByRole("tab", { name: "coloring.arabic" }));
				await waitFor(() => expect(description().value).toBe(""));
				fireEvent.change(nameInput(view), { target: { value: "ميرا" } });
				fireEvent.change(description(), { target: { value: "وصف عربي" } });
				fireEvent.click(view.getByRole("tab", { name: "coloring.english" }));
				await waitFor(() =>
					expect(description().value).toBe("English description"),
				);
				if (kind === "keyword") await chooseStyles(view);
				const form = view
					.getByRole("button", { name: "_.save" })
					.closest("form");
				if (!form) throw new Error("form missing");
				fireEvent.submit(form);
				await waitFor(async () =>
					expect(await env.db.mutations.count()).toBe(1),
				);
				const [mutation] = await env.db.mutations.toArray();
				expect(mutation?.patch).toMatchObject({
					descriptionEn: "English description",
					descriptionAr: "وصف عربي",
				});
			} finally {
				view.unmount();
			}
		});
	}

	it("saves both tabs' names typed by hand, without a link", async () => {
		const view = await openKeywordForm("Leo");
		const previousUrl = window.location.href;
		try {
			fireEvent.click(view.getByRole("tab", { name: "coloring.arabic" }));
			await waitFor(() => expect(nameInput(view).value).toBe(""));
			fireEvent.change(nameInput(view), { target: { value: "ليو" } });
			await chooseStyles(view);
			const form = view.getByRole("button", { name: "_.save" }).closest("form");
			if (!form) throw new Error("the keyword form is missing");
			fireEvent.submit(form);

			await waitFor(async () => expect(await env.db.mutations.count()).toBe(1));
			const [mutation] = await env.db.mutations.toArray();
			expect(mutation?.patch).toMatchObject({ nameEn: "Leo", nameAr: "ليو" });
			expect(mutation?.patch.translationKeywordId).toBeUndefined();
		} finally {
			view.unmount();
			window.history.replaceState(null, "", previousUrl);
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

function renderAppearanceTab(appearanceStore = createStore()) {
	const view = render(
		React.createElement(
			JotaiProvider,
			{ store: appearanceStore },
			React.createElement(
				MantineProvider,
				null,
				React.createElement(AppearanceTab),
			),
		),
	);
	const sliders = view.getAllByRole("slider");
	return {
		view,
		store: appearanceStore,
		fontSize: sliders[0],
		nightLight: sliders[1],
	};
}

const range = (slider: HTMLElement | undefined) => [
	slider?.getAttribute("aria-valuemin"),
	slider?.getAttribute("aria-valuemax"),
	slider?.getAttribute("aria-valuenow"),
];

describe("appearance settings", () => {
	afterEach(() => {
		window.localStorage.clear();
		document.documentElement.removeAttribute("dir");
	});

	it("starts word VFX off and persists the reader's switch choice", () => {
		const { view, store } = renderAppearanceTab();
		const toggle = view.getByRole("switch", {
			name: /^settings\.appearance\.showWordVfx/,
		}) as HTMLInputElement;
		expect(toggle.checked).toBe(false);
		fireEvent.click(toggle);
		expect(store.get(showWordVfxAtom)).toBe(true);
		expect(window.localStorage.getItem(SHOW_WORD_VFX_KEY)).toBe("true");
		fireEvent.click(toggle);
		expect(store.get(showWordVfxAtom)).toBe(false);
	});

	it("defaults to On click and saves the selected tooltip trigger", () => {
		const { view, store } = renderAppearanceTab();
		const click = view.getByRole("radio", {
			name: "settings.appearance.onClick",
		}) as HTMLInputElement;
		const hover = view.getByRole("radio", {
			name: "settings.appearance.onHover",
		}) as HTMLInputElement;
		expect(click.checked).toBe(true);
		fireEvent.click(hover);
		expect(store.get(tooltipTriggerAtom)).toBe("hover");
		expect(window.localStorage.getItem(TOOLTIP_TRIGGER_KEY)).toBe('"hover"');
		fireEvent.click(click);
		expect(store.get(tooltipTriggerAtom)).toBe("click");
	});

	it("loads the saved trigger before the popup mirrors it to page storage", async () => {
		const load = async (suffix: string) => {
			const path = `../../src/store/appearance.ts?${suffix}`;
			const { tooltipTriggerAtom: atom } = (await import(
				path
			)) as typeof import("../../src/store/appearance");
			return createStore().get(atom);
		};
		window.localStorage.setItem(TOOLTIP_TRIGGER_KEY, '"hover"');
		expect(await load("tooltip-trigger-saved")).toBe("hover");
		window.localStorage.setItem(TOOLTIP_TRIGGER_KEY, '"invalid"');
		expect(await load("tooltip-trigger-invalid")).toBe("click");
	});

	it("loads saved word VFX before mirroring and rejects non-boolean values", async () => {
		const load = async (suffix: string) => {
			const path = `../../src/store/appearance.ts?${suffix}`;
			const { showWordVfxAtom: atom } = (await import(
				path
			)) as typeof import("../../src/store/appearance");
			return createStore().get(atom);
		};
		window.localStorage.setItem(SHOW_WORD_VFX_KEY, "true");
		expect(await load("category-effects-saved")).toBe(true);
		window.localStorage.setItem(SHOW_WORD_VFX_KEY, '"true"');
		expect(await load("category-effects-invalid")).toBe(false);
	});

	it("starts the popup atom at the saved size and resets the old default", async () => {
		// A fresh popup evaluates its store module after localStorage is available.
		const load = async (suffix: string) => {
			const path = `../../src/store/appearance.ts?${suffix}`;
			const { fontSizeAtom: atom } = (await import(
				path
			)) as typeof import("../../src/store/appearance");
			return createStore().get(atom);
		};
		expect(await load("font-size-unset")).toBe(24);
		window.localStorage.setItem(APPEARANCE_FONT_SIZE_KEY, "30");
		expect(await load("font-size-saved")).toBe(30);
		window.localStorage.setItem(APPEARANCE_FONT_SIZE_KEY, "14");
		expect(await load("font-size-old-default")).toBe(24);
	});

	it("shows font size and night light as sliders with their ranges", () => {
		const { view, fontSize, nightLight } = renderAppearanceTab();
		expect(range(fontSize)).toEqual(["18", "42", "24"]);
		expect(range(nightLight)).toEqual(["10", "80", "30"]);
		expect(fontSize?.getAttribute("aria-label")).toBe(
			"settings.appearance.fontSize",
		);
		expect(nightLight?.getAttribute("aria-label")).toBe(
			"settings.appearance.nightLightLevel",
		);
		for (const text of ["24px", "18px", "42px", "30%", "10%", "80%"])
			expect(view.getByText(text)).toBeTruthy();
		// No number fields left (Mantine's NumberInput sets an input mode).
		expect(view.container.querySelectorAll("input[inputmode]")).toHaveLength(0);
	});

	it("saves each step, stopping at the ends of the range", () => {
		const { view, store, fontSize, nightLight } = renderAppearanceTab();
		if (!fontSize || !nightLight) throw new Error("sliders missing");
		fireEvent.keyDown(fontSize, { key: "ArrowRight" });
		expect(store.get(fontSizeAtom)).toBe(25);
		expect(window.localStorage.getItem(APPEARANCE_FONT_SIZE_KEY)).toBe("25");
		expect(view.getByText("25px")).toBeTruthy();
		fireEvent.keyDown(fontSize, { key: "End" });
		fireEvent.keyDown(fontSize, { key: "ArrowRight" });
		expect(store.get(fontSizeAtom)).toBe(42);
		fireEvent.keyDown(fontSize, { key: "Home" });
		expect(store.get(fontSizeAtom)).toBe(18);

		fireEvent.keyDown(nightLight, { key: "ArrowRight" });
		expect(store.get(nightLightLevelAtom)).toBe(35);
		expect(window.localStorage.getItem(NIGHT_LIGHT_LEVEL_KEY)).toBe("35");
		fireEvent.keyDown(nightLight, { key: "ArrowLeft" });
		fireEvent.keyDown(nightLight, { key: "ArrowLeft" });
		expect(store.get(nightLightLevelAtom)).toBe(25);
	});

	it("maps English track clicks to their positions even after a language change", async () => {
		// The document may still have the previous language's direction during a
		// render; the control must use the selected language instead.
		document.documentElement.setAttribute("dir", "rtl");
		const appearanceStore = createStore();
		appearanceStore.set(fontSizeAtom, 42);
		appearanceStore.set(nightLightLevelAtom, 80);
		const { store, fontSize, nightLight } =
			renderAppearanceTab(appearanceStore);
		if (!fontSize || !nightLight) throw new Error("sliders missing");
		expect(fontSize.style.left).toBe("var(--slider-thumb-offset)");
		expect(fontSize.style.right).toBe("auto");
		const fontTrack = fontSize.parentElement?.parentElement;
		const nightTrack = nightLight.parentElement?.parentElement;
		if (!fontTrack || !nightTrack) throw new Error("slider tracks missing");
		const bounds = () =>
			({ left: 0, top: 0, width: 100, height: 16 }) as DOMRect;
		fontTrack.getBoundingClientRect = bounds;
		nightTrack.getBoundingClientRect = bounds;
		fireEvent.mouseDown(fontTrack, { clientX: 25, clientY: 8 });
		await waitFor(() => expect(store.get(fontSizeAtom)).toBe(24));
		fireEvent.mouseUp(document);
		fireEvent.mouseDown(nightTrack, { clientX: 29, clientY: 8 });
		await waitFor(() => expect(store.get(nightLightLevelAtom)).toBe(30));
		fireEvent.mouseUp(document);
	});

	it("shows a saved night light level outside 10 to 80 clamped", () => {
		const saved = createStore();
		saved.set(nightLightLevelAtom, 95);
		const { nightLight } = renderAppearanceTab(saved);
		expect(range(nightLight)).toEqual(["10", "80", "80"]);
	});

	it("follows the selected language, so ArrowLeft raises the level in Arabic", () => {
		const appearanceStore = createStore();
		appearanceStore.set(localeAtom, "ar");
		const { store, fontSize } = renderAppearanceTab(appearanceStore);
		if (!fontSize) throw new Error("slider missing");
		expect(fontSize.closest('[dir="rtl"]')).not.toBeNull();
		expect(fontSize.style.left).toBe("auto");
		fireEvent.keyDown(fontSize, { key: "ArrowLeft" });
		expect(store.get(fontSizeAtom)).toBe(25);
		fireEvent.keyDown(fontSize, { key: "ArrowRight" });
		fireEvent.keyDown(fontSize, { key: "ArrowRight" });
		expect(store.get(fontSizeAtom)).toBe(23);
	});
});

describe("Cloud and lens UI", async () => {
	const { AiTab } = await import("../../src/entrypoints/popup.settings/ai-tab");
	const { SelectionView } = await import(
		"../../src/entrypoints/popup/selection-view"
	);
	const { LensBalanceButton } = await import(
		"../../src/components/navbar/lens-balance-button"
	);
	const { LensCelebration } = await import(
		"../../src/components/lens/lens-celebration"
	);
	const { AiPrice } = await import("../../src/components/lens/ai-price");
	const runtime = fakeBrowser.runtime as { sendMessage: unknown };
	let original: unknown;
	let messages: { type: string; data: Record<string, unknown> }[];
	let savedMatchMedia: typeof window.matchMedia;
	const pricing = {
		currency: "USD",
		available: true,
		lensPriceUsd: "0.01",
		lensPriceMicros: 10000,
		trialLenses: 10,
		request: { min: 100, max: 50000, pendingMax: 3 },
		cloudAi: { enabled: true },
		features: [
			{
				key: "character_image",
				nameEn: "Character image",
				nameAr: "صورة شخصية",
				lenses: 3,
				enabled: true,
				maxPromptChars: 40000,
			},
			{
				key: "keyword_suggestion",
				nameEn: "Suggestion",
				nameAr: "اقتراح",
				lenses: 1,
				enabled: true,
				maxPromptChars: 40000,
			},
		],
	};
	beforeEach(async () => {
		messages = [];
		savedMatchMedia = window.matchMedia;
		window.matchMedia = ((query: string) => {
			const media = savedMatchMedia(query);
			Object.defineProperty(media, "matches", {
				value: query === "(prefers-reduced-motion: reduce)",
				configurable: true,
			});
			return media;
		}) as typeof window.matchMedia;
		original = runtime.sendMessage;
		runtime.sendMessage = async (message: unknown) => {
			const item = message as { type: string; data: Record<string, unknown> };
			messages.push(item);
			return {
				res:
					item.type === "claimLensNotices"
						? item.data.ids
						: item.type === "markLensNoticesSeen"
							? true
							: undefined,
			};
		};
		await fakeBrowser.storage.local.set({
			"storylens-ai-source": "cloud",
			"storylens-ai-pricing": { data: pricing, fetchedAt: Date.now() },
			"storylens-lens-balance": {
				userId: env.user.id,
				balance: 128,
				updatedAt: Date.now(),
			},
		});
	});
	afterEach(() => {
		runtime.sendMessage = original;
		window.matchMedia = savedMatchMedia;
	});
	it("switches source panels and stores the explicit choice", async () => {
		const view = render(React.createElement(AiTab), { wrapper });
		await waitFor(() =>
			expect(view.getByText("cloud.disclosure")).toBeTruthy(),
		);
		await waitFor(() =>
			expect(
				(view.getByRole("radio", { name: "cloud.desktop" }) as HTMLInputElement)
					.disabled,
			).toBe(false),
		);
		fireEvent.click(view.getByText("cloud.desktop"));
		await waitFor(() =>
			expect(view.getByLabelText("desktop.port")).toBeTruthy(),
		);
		expect(
			(await fakeBrowser.storage.local.get("storylens-ai-source"))[
				"storylens-ai-source"
			],
		).toBe("desktop");
		expect(
			messages.some(
				(message) =>
					message.type === "trackAnalyticsEvent" &&
					message.data.name === "ai_source_changed",
			),
		).toBe(true);
	});
	it("keeps text and image choices independent and preserves legacy image routing", async () => {
		const view = render(React.createElement(AiTab), { wrapper });
		await waitFor(() =>
			expect(
				view.getByLabelText("cloud.imageSource", { selector: "input" }),
			).toBeTruthy(),
		);
		await waitFor(() =>
			expect(
				(view.getByRole("radio", { name: "cloud.desktop" }) as HTMLInputElement)
					.disabled,
			).toBe(false),
		);
		fireEvent.click(view.getByText("cloud.desktop"));
		await waitFor(() =>
			expect(fakeBrowser.storage.local.peek("storylens-ai-source")).toBe(
				"desktop",
			),
		);
		expect(fakeBrowser.storage.local.peek("storylens-ai-image-source")).toBe(
			"cloud",
		);
		const select = view.getByLabelText("cloud.imageSource", {
			selector: "input",
		});
		fireEvent.click(select);
		fireEvent.click(
			await view.findByRole("option", {
				name: "cloud.desktopImages",
				hidden: true,
			}),
		);
		await waitFor(() =>
			expect(fakeBrowser.storage.local.peek("storylens-ai-image-source")).toBe(
				"desktop",
			),
		);
		fireEvent.click(view.getByRole("radio", { name: "cloud.name" }));
		await waitFor(() =>
			expect(fakeBrowser.storage.local.peek("storylens-ai-source")).toBe(
				"cloud",
			),
		);
		expect(fakeBrowser.storage.local.peek("storylens-ai-image-source")).toBe(
			"desktop",
		);
		expect(view.getByLabelText("desktop.port")).toBeTruthy();
	});
	it("starts Use AI off for both sources and shows the Cloud price only", async () => {
		const view = render(React.createElement(SelectionView), { wrapper });
		await waitFor(() => expect(view.getByText("1")).toBeTruthy());
		expect(
			(view.getByRole("switch", { name: /selection.ai/ }) as HTMLInputElement)
				.checked,
		).toBe(false);
		await fakeBrowser.storage.local.set({ "storylens-ai-source": "desktop" });
		await waitFor(() => expect(view.queryByText("1") === null).toBe(true));
		expect(
			(view.getByRole("switch", { name: /selection.ai/ }) as HTMLInputElement)
				.checked,
		).toBe(false);
	});

	it("enables image generation only with AI, clears it when AI is off, and respects feature availability", async () => {
		const view = render(React.createElement(SelectionView), { wrapper });
		const ai = view.getByRole("switch", {
			name: /selection.ai/,
		}) as HTMLInputElement;
		const image = view.getByRole("switch", {
			name: /selection.generateImage/,
		}) as HTMLInputElement;
		await waitFor(() => expect(view.getByText("3")).toBeTruthy());
		expect(image.disabled).toBe(true);
		expect(image.checked).toBe(false);
		fireEvent.click(ai);
		await waitFor(() => expect(image.disabled).toBe(false));
		fireEvent.click(image);
		expect(image.checked).toBe(true);
		fireEvent.click(ai);
		expect(image.disabled).toBe(true);
		expect(image.checked).toBe(false);
		fireEvent.click(ai);
		expect(image.checked).toBe(false);
		await fakeBrowser.storage.local.set({
			"storylens-ai-pricing": {
				data: {
					...pricing,
					features: pricing.features.map((feature) =>
						feature.key === "character_image"
							? { ...feature, enabled: false }
							: feature,
					),
				},
				fetchedAt: Date.now(),
			},
		});
		await waitFor(() => expect(image.disabled).toBe(true));
	});

	it("shows a positive price live and hides free and desktop prices", async () => {
		const view = render(
			React.createElement(AiPrice, { feature: "character_image" }),
			{ wrapper },
		);
		await waitFor(() => expect(view.getByText("3")).toBeTruthy());
		await fakeBrowser.storage.local.set({
			"storylens-ai-pricing": {
				data: {
					...pricing,
					features: pricing.features.map((feature) => ({
						...feature,
						lenses: 0,
					})),
				},
				fetchedAt: Date.now(),
			},
		});
		await waitFor(() => expect(view.queryByText("3") === null).toBe(true));
		await fakeBrowser.storage.local.set({
			"storylens-ai-source": "desktop",
			"storylens-ai-pricing": { data: pricing, fetchedAt: Date.now() },
		});
		await waitFor(() =>
			expect(view.container.querySelector("svg") === null).toBe(true),
		);
	});
	it("shows account balance for Desktop too and ignores a different account's cache", async () => {
		await fakeBrowser.storage.local.set({ "storylens-ai-source": "desktop" });
		const view = render(React.createElement(LensBalanceButton), { wrapper });
		await waitFor(() => expect(view.getByText("128")).toBeTruthy());
		fireEvent.click(view.getByRole("button"));
		await waitFor(() =>
			expect(
				messages.find((message) => message.type === "openLensPage")?.data
					.reason,
			).toBe("navbar"),
		);
		await fakeBrowser.storage.local.set({
			"storylens-lens-balance": {
				userId: "another",
				balance: 500,
				updatedAt: Date.now(),
			},
		});
		await waitFor(() => expect(view.getByText("—")).toBeTruthy());
	});
	it("celebrates a purchase as well as gifts, acknowledges once and uses reduced motion", async () => {
		const originalMatch = window.matchMedia;
		window.matchMedia = ((query: string) => {
			const media = originalMatch(query);
			Object.defineProperty(media, "matches", {
				value: query === "(prefers-reduced-motion: reduce)",
				configurable: true,
			});
			return media;
		}) as typeof window.matchMedia;
		try {
			await fakeBrowser.storage.local.set({
				"storylens-lens-notices": {
					userId: env.user.id,
					notices: [
						{
							id: "trial",
							type: "TRIAL_GIFT",
							lenses: 10,
							note: null,
							createdAt: "2026-10-02",
						},
						{
							id: "gift",
							type: "ADMIN_GIFT",
							lenses: 50,
							note: "Enjoy reading",
							createdAt: "2026-10-02",
						},
						{
							id: "purchase",
							type: "TOP_UP",
							lenses: 500,
							note: null,
							createdAt: "2026-10-02",
						},
					],
				},
			});
			const view = render(React.createElement(LensCelebration), { wrapper });
			await waitFor(() => expect(view.getByRole("dialog")).toBeTruthy());
			expect(view.getByText(/Enjoy reading/)).toBeTruthy();
			await waitFor(() =>
				expect(
					messages.filter((message) => message.type === "markLensNoticesSeen"),
				).toHaveLength(1),
			);
			expect(
				messages.find((message) => message.type === "markLensNoticesSeen")?.data
					.ids,
			).toEqual(["trial", "gift", "purchase"]);
			fireEvent.click(view.getByRole("button", { name: "_.close" }));
			await waitFor(() =>
				expect(view.queryByRole("dialog") === null).toBe(true),
			);
		} finally {
			window.matchMedia = originalMatch;
		}
	});
	it("does not reopen an acknowledged dialog after an account switch", async () => {
		const saved = fakeBrowser.storage.local.peek("storylens-auth");
		await fakeBrowser.storage.local.set({
			"storylens-lens-notices": {
				userId: env.user.id,
				notices: [
					{
						id: "gift",
						type: "ADMIN_GIFT",
						lenses: 50,
						note: null,
						createdAt: "2026-10-02",
					},
				],
			},
		});
		const view = render(React.createElement(LensCelebration), { wrapper });
		await waitFor(() => expect(!!view.queryByRole("dialog")).toBe(true));
		await waitFor(() =>
			expect(
				messages.filter((message) => message.type === "markLensNoticesSeen")
					.length,
			).toBe(1),
		);
		await fakeBrowser.storage.local.set({
			"storylens-auth": JSON.stringify({
				user: makeUser("other"),
				token: "other-token",
			}),
		});
		await waitFor(() => expect(!!view.queryByRole("dialog")).toBe(false));
		await act(async () => {
			await fakeBrowser.storage.local.set({ "storylens-auth": saved });
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect(!!view.queryByRole("dialog")).toBe(false);
	});
});

describe("sync issue recovery details", () => {
	it("shows the novel and parent of a chapter version, and lets the reader edit it", async () => {
		const { SyncPage } = await import(
			"../../src/entrypoints/popup.sync/sync-page"
		);
		const { createInstance } = await import("i18next");
		const { I18nextProvider } = await import("react-i18next");
		const { default: en } = await import("../../public/locales/en.json");
		const i18n = createInstance();
		await i18n.init({
			lng: "en",
			resources: { en: { translation: en } },
			interpolation: { escapeValue: false },
		});
		const { BrowserRouter } = await import("react-router");
		const { getSyncStatus } = await import("../../src/lib/offline/sync/status");
		const keyword = env.api.seedKeyword(
			env.novel.id,
			{ nameEn: "Mira", categoryId: env.category.id, natureId: env.nature.id },
			env.user.id,
		);
		await pullLookups({ db: env.db, token: "token-reader-1" });
		await pullNovel(env.novel.id, { db: env.db, token: "token-reader-1" });
		const created = await enqueue(
			{
				entity: "keywordVersion",
				op: "create",
				keywordId: keyword.id,
				values: { currentChapter: 543 },
			},
			{ db: env.db },
		);
		await env.db.mutations
			.where("id")
			.equals(created.mutationId ?? "")
			.modify({
				status: "rejected",
				conflict: { kind: "rule" },
				lastError: {
					message: "Chapter must follow the last version",
					at: Date.now(),
				},
			});
		const runtime = fakeBrowser.runtime as unknown as {
			sendMessage: (message: unknown) => Promise<unknown>;
		};
		const previous = runtime.sendMessage;
		runtime.sendMessage = async () => ({ res: await getSyncStatus(env.db) });
		try {
			const view = render(
				React.createElement(
					I18nextProvider,
					{ i18n },
					React.createElement(
						BrowserRouter,
						null,
						React.createElement(SyncPage),
					),
				),
				{ wrapper },
			);
			await waitFor(() =>
				expect(view.getByText("Keyword: Mira")).toBeDefined(),
			);
			expect(view.getByText("Novel: Novel")).toBeDefined();
			expect(view.getByText("ch.543+")).toBeDefined();
			expect(view.queryByText(en.sync.allSynced)).toBeNull();
			fireEvent.click(view.getByRole("button", { name: "Edit" }));
			const chapter = view.getByRole("textbox");
			fireEvent.change(chapter, { target: { value: "544" } });
			fireEvent.click(view.getByRole("button", { name: "Save" }));
			await waitFor(async () =>
				expect(
					(await env.db.mutations.toArray())[0]?.patch.currentChapter,
				).toBe(544),
			);
			await waitFor(() =>
				expect(view.queryByRole("button", { name: "Save" })).toBeNull(),
			);
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 30));
			});
			view.unmount();
		} finally {
			runtime.sendMessage = previous;
		}
	});
});

describe("parallel selection suggestions and images", () => {
	const runtime = fakeBrowser.runtime as { sendMessage: unknown };
	let original: unknown;
	let previousUrl: string;
	let requests: { type: string; data: Record<string, unknown> }[];
	let finishSuggestion: (value: unknown) => void;
	let finishImage: (value: unknown) => void;

	beforeEach(async () => {
		previousUrl = window.location.href;
		original = runtime.sendMessage;
		requests = [];
		const suggestionReply = new Promise<unknown>((resolve) => {
			finishSuggestion = resolve;
		});
		const imageReply = new Promise<unknown>((resolve) => {
			finishImage = resolve;
		});
		runtime.sendMessage = async (message: unknown) => {
			const item = message as { type: string; data: Record<string, unknown> };
			requests.push(item);
			if (item.type === "executeAiPrompt") return suggestionReply;
			if (item.type === "generateAiImage") return imageReply;
			return { res: undefined };
		};
		env.novel.context = "A fantasy novel.";
		store.set(localeAtom, "en");
		await fakeBrowser.storage.local.set({
			"storylens-ai-source": "desktop",
			"storylens-desktop-client": {
				token: "paired",
				model: "test-model",
				effort: "low",
			},
			"storylens-ai-prompts": {
				keywordPrompt: "Write concise details.",
				imagePrompt: "Draw a watercolor portrait.",
			},
		});
	});
	afterEach(() => {
		cleanup();
		finishSuggestion({ res: undefined });
		finishImage({ res: undefined });
		runtime.sendMessage = original;
		window.history.replaceState(null, "", previousUrl);
	});
	async function open(
		kind: "keyword" | "alias" | "version" = "keyword",
		generate = true,
	) {
		const parent = env.api.seedKeyword(
			env.novel.id,
			{
				nameEn: "Parent",
				categoryId: env.category.id,
				natureId: env.nature.id,
			},
			env.user.id,
		);
		await pullLookups({ db: env.db, token: "token-reader-1" });
		await pullNovel(env.novel.id, { db: env.db, token: "token-reader-1" });
		window.history.replaceState(
			null,
			"",
			`?${new URLSearchParams({
				create: kind,
				search: "Rand",
				parentId: parent.id,
				aiContext: JSON.stringify({
					before: "The red-haired ",
					after: " carried a sword.",
				}),
				...(generate ? { generate: "image" } : {}),
			})}`,
		);
		return render(
			React.createElement(
				PageContent,
				null,
				React.createElement(ColoringTab, {
					selectedNovelId: env.novel.id,
					currentChapter: kind === "version" ? 10 : 0,
				}),
			),
			{ wrapper },
		);
	}
	const suggestion = () =>
		finishSuggestion({
			res: {
				ok: true,
				value: JSON.stringify({
					description: "A shepherd.",
					category: 1,
					nature: 1,
				}),
			},
		});
	const image = () =>
		finishImage({
			res: {
				ok: true,
				value: {
					data: "AA==",
					mimeType: "image/png",
					revisedPrompt: "A red-haired swordsman.",
				},
			},
		});
	const bothStarted = () =>
		waitFor(() => {
			expect(
				requests.filter((item) => item.type === "executeAiPrompt"),
			).toHaveLength(1);
			expect(
				requests.filter((item) => item.type === "generateAiImage"),
			).toHaveLength(1);
		});

	for (const kind of ["keyword", "alias", "version"] as const) {
		it(`runs both actions concurrently and saves the generated image with its ${kind}`, async () => {
			const view = await open(kind);
			await bothStarted();
			const prompt = requests.find((item) => item.type === "generateAiImage")
				?.data.prompt;
			if (typeof prompt !== "string") throw new Error("image prompt missing");
			expect(prompt).toContain("Draw a watercolor portrait.");
			expect(prompt).toContain("The red-haired Rand carried a sword.");
			expect(prompt).toContain("A fantasy novel.");
			await act(async () => {
				suggestion();
			});
			expect(view.queryByRole("button", { name: "_.save" })).toBeNull();
			await act(async () => {
				image();
			});
			await waitFor(() =>
				expect(view.getByAltText("coloring.imagePreview")).toBeTruthy(),
			);
			expect(view.getByText("A red-haired swordsman.")).toBeTruthy();
			const copy = view.getByRole("button", {
				name: "coloring.copyImagePrompt",
			});
			expect(
				copy.compareDocumentPosition(
					view.getByAltText("coloring.imagePreview"),
				) & Node.DOCUMENT_POSITION_FOLLOWING,
			).toBeTruthy();
			const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
			const copied: string[] = [];
			Object.defineProperty(navigator, "clipboard", {
				configurable: true,
				value: {
					writeText: async (text: string) => {
						copied.push(text);
					},
				},
			});
			try {
				fireEvent.click(copy);
				await waitFor(() => expect(copied).toEqual([prompt]));
				await waitFor(() =>
					expect(view.getByText("coloring.imagePromptCopied")).toBeTruthy(),
				);
			} finally {
				if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
				else Reflect.deleteProperty(navigator, "clipboard");
			}
			expect(
				(view.getByLabelText("coloring.description") as HTMLInputElement).value,
			).toContain("A shepherd.");
			expect(new URLSearchParams(window.location.search).has("generate")).toBe(
				false,
			);
			const save = view.getByRole("button", { name: "_.save" });
			const form = save.closest("form");
			if (!form) throw new Error("entry form missing");
			setOnline(false);
			fireEvent.submit(form);
			await waitFor(async () => expect(await env.db.files.count()).toBe(1));
			await waitFor(() => expect(store.get(formPageAtom)).toBeNull());
			expect(
				requests.filter((item) => item.type === "generateAiImage"),
			).toHaveLength(1);
		});
	}

	it("keeps the generated image when an AI translation link loads its inherited style", async () => {
		env.api.seedKeyword(
			env.novel.id,
			{
				nameAr: "راند",
				nameEn: null,
				categoryId: env.category.id,
				natureId: env.nature.id,
			},
			env.user.id,
		);
		const view = await open();
		await bothStarted();
		finishSuggestion({
			res: {
				ok: true,
				value: JSON.stringify({
					description: "A shepherd.",
					category: 1,
					nature: 1,
					translation: 1,
				}),
			},
		});
		image();
		await waitFor(() =>
			expect(view.getByAltText("coloring.imagePreview")).toBeTruthy(),
		);
		fireEvent.click(view.getByRole("tab", { name: "coloring.arabic" }));
		await waitFor(() =>
			expect(
				(
					view.getByLabelText("coloring.name", {
						selector: "input",
					}) as HTMLInputElement
				).value,
			).toBe("راند"),
		);
		expect(view.getByAltText("coloring.imagePreview")).toBeTruthy();
		const form = view.getByRole("button", { name: "_.save" }).closest("form");
		if (!form) throw new Error("entry form missing");
		setOnline(false);
		fireEvent.submit(form);
		await waitFor(async () => expect(await env.db.files.count()).toBe(1));
	});

	it("keeps the image when the suggestion fails", async () => {
		const view = await open();
		await bothStarted();
		finishSuggestion({
			res: {
				ok: false,
				failure: {
					code: "AI_PROVIDER_FAILED",
					message: "Suggestion failed",
					details: {},
				},
			},
		});
		image();
		await waitFor(() =>
			expect(view.getByAltText("coloring.imagePreview")).toBeTruthy(),
		);
		expect(view.getByText(/coloring.aiFailed/)).toBeTruthy();
		expect(view.getByRole("button", { name: "_.save" })).toBeTruthy();
	});
	it("keeps suggested fields and allows retrying a failed image", async () => {
		const view = await open();
		await bothStarted();
		suggestion();
		finishImage({
			res: {
				ok: false,
				failure: {
					code: "AI_PROVIDER_FAILED",
					message: "Image failed",
					details: {},
				},
			},
		});
		await waitFor(() =>
			expect(view.getByRole("button", { name: "_.save" })).toBeTruthy(),
		);
		expect(view.getByDisplayValue("A shepherd.")).toBeTruthy();
		expect(view.getByText(/coloring.imageGenerateFailed/)).toBeTruthy();
		expect(
			view.getByRole("button", { name: "coloring.copyImagePrompt" }),
		).toBeTruthy();
		expect(
			view
				.getByRole("button", { name: /coloring.generateImage$/ })
				.hasAttribute("data-disabled"),
		).toBe(false);
	});

	for (const kind of ["keyword", "alias", "version"] as const) {
		it(`stops a selection image for ${kind} without stopping its text suggestion`, async () => {
			const view = await open(kind);
			await bothStarted();
			const imageRequest = requests.find(
				(item) => item.type === "generateAiImage",
			)?.data;
			const textRequest = requests.find(
				(item) => item.type === "executeAiPrompt",
			)?.data;
			fireEvent.click(view.getByRole("button", { name: "coloring.stopImage" }));
			await waitFor(() =>
				expect(
					requests.some(
						(item) =>
							item.type === "cancelAiPrompt" &&
							(item.data as unknown) === imageRequest?.requestId,
					),
				).toBe(true),
			);
			expect(
				requests.some(
					(item) =>
						item.type === "cancelAiPrompt" &&
						(item.data as unknown) === textRequest?.requestId,
				),
			).toBe(false);
			suggestion();
			await waitFor(() =>
				expect(view.getByRole("button", { name: "_.save" })).toBeTruthy(),
			);
			expect(view.getByText("coloring.imageStopped")).toBeTruthy();
			expect(
				view.getByRole("button", { name: "coloring.copyImagePrompt" }),
			).toBeTruthy();
			expect(view.getByDisplayValue(/A shepherd/)).toBeTruthy();
			await act(async () => {
				image();
			});
			expect(view.queryByAltText("coloring.imagePreview")).toBeNull();
			expect(view.queryByText(/coloring.imageGenerateFailed/)).toBeNull();
			expect(
				requests.filter((item) => item.type === "generateAiImage"),
			).toHaveLength(1);
		});
	}
	it("sends no image request with only Use AI enabled", async () => {
		const view = await open("keyword", false);
		await waitFor(() =>
			expect(
				requests.filter((item) => item.type === "executeAiPrompt"),
			).toHaveLength(1),
		);
		suggestion();
		await waitFor(() =>
			expect(view.getByRole("button", { name: "_.save" })).toBeTruthy(),
		);
		expect(
			requests.filter((item) => item.type === "generateAiImage"),
		).toHaveLength(0);
	});

	for (const textSource of ["cloud", "desktop"] as const) {
		it(`routes ${textSource} text and the other image source independently`, async () => {
			const imageSource = textSource === "cloud" ? "desktop" : "cloud";
			await fakeBrowser.storage.local.set({
				"storylens-ai-source": textSource,
				"storylens-ai-image-source": imageSource,
				"storylens-ai-pricing": {
					data: {
						cloudAi: { enabled: true },
						features: [
							{ key: "keyword_suggestion", lenses: 1, enabled: true },
							{ key: "character_image", lenses: 3, enabled: true },
						],
					},
				},
			});
			const view = await open();
			await bothStarted();
			expect(
				requests.find((item) => item.type === "executeAiPrompt")?.data.source,
			).toBe(textSource);
			const imageRequest = requests.find(
				(item) => item.type === "generateAiImage",
			)?.data;
			expect(imageRequest?.source).toBe(imageSource);
			expect(imageRequest?.model).toBe("codex");
			expect(imageRequest?.effort).toBe("default");
			suggestion();
			image();
			await waitFor(() =>
				expect(
					view.getByRole("button", { name: "coloring.copyImagePrompt" }),
				).toBeTruthy(),
			);
		});
	}
	it("preserves the combined Cloud budget by skipping optional research", async () => {
		env.novel.context = null;
		await fakeBrowser.storage.local.set({
			"storylens-ai-source": "cloud",
			"storylens-ai-pricing": {
				data: {
					cloudAi: { enabled: true },
					features: [
						{ key: "keyword_suggestion", lenses: 1, enabled: true },
						{ key: "character_image", lenses: 3, enabled: true },
						{ key: "novel_context", lenses: 2, enabled: true },
					],
				},
				fetchedAt: Date.now(),
			},
			"storylens-lens-balance": {
				userId: env.user.id,
				balance: 4,
				updatedAt: Date.now(),
			},
		});
		const view = await open();
		await bothStarted();
		expect(
			requests.some(
				(item) => item.type === "executeAiPrompt" && item.data.webSearch,
			),
		).toBe(false);
		expect(
			requests.find((item) => item.type === "generateAiImage")?.data.source,
		).toBe("cloud");
		suggestion();
		image();
		await waitFor(() =>
			expect(view.getByAltText("coloring.imagePreview")).toBeTruthy(),
		);
	});
	it("researches missing novel context once for both actions", async () => {
		env.novel.context = null;
		const handler = runtime.sendMessage as (
			message: unknown,
		) => Promise<unknown>;
		runtime.sendMessage = async (message: unknown) => {
			const item = message as { type: string; data: Record<string, unknown> };
			if (item.type === "executeAiPrompt" && item.data.webSearch) {
				requests.push(item);
				return { res: { ok: true, value: "A fantasy novel." } };
			}
			return handler(message);
		};
		const view = await open();
		await waitFor(() => {
			expect(
				requests.filter(
					(item) => item.type === "executeAiPrompt" && item.data.webSearch,
				),
			).toHaveLength(1);
			expect(
				requests.filter(
					(item) => item.type === "executeAiPrompt" && !item.data.webSearch,
				),
			).toHaveLength(1);
			expect(
				requests.filter((item) => item.type === "generateAiImage"),
			).toHaveLength(1);
		});
		suggestion();
		image();
		await waitFor(() =>
			expect(view.getByAltText("coloring.imagePreview")).toBeTruthy(),
		);
	});

	it("cancels both requests when their popup unmounts", async () => {
		const view = await open();
		await bothStarted();
		const ids = requests
			.filter(
				(item) =>
					item.type === "executeAiPrompt" || item.type === "generateAiImage",
			)
			.map((item) => item.data.requestId);
		view.unmount();
		await waitFor(() =>
			expect(
				requests
					.filter((item) => item.type === "cancelAiPrompt")
					.map((item) => item.data),
			).toEqual(expect.arrayContaining(ids)),
		);
	});
});

describe("category form", () => {
	it("does not offer category-wide effects", async () => {
		env = await setupEngine({ moderator: true });
		store.set(authStateAtom, { user: env.user, token: "token-reader-1" });
		const { CategoryForm } = await import(
			"../../src/entrypoints/popup.settings/category-form"
		);
		const view = render(
			React.createElement(
				PageContent,
				null,
				React.createElement(CategoryForm, { mode: "add", onClose: () => {} }),
			),
			{ wrapper },
		);
		expect(view.queryByLabelText("settings.effect")).toBeNull();
		expect(view.queryByLabelText("coloring.wordVfx")).toBeNull();
	});
});

describe("personal category and nature colors", () => {
	for (const kind of ["category", "nature"] as const) {
		it(`lets guests save and clear only their personal ${kind} color`, async () => {
			const { savePersonalColor, readColorPreferences } = await import(
				"../../src/lib/personal-colors/background"
			);
			const { signIn } = await import("../helpers/engine");
			const guest = makeUser("guest-color-ui", { guest: true });
			await signIn(guest);
			store.set(authStateAtom, { user: guest, token: "token-guest-color-ui" });
			const runtime = fakeBrowser.runtime as unknown as {
				sendMessage: (message: unknown) => Promise<unknown>;
			};
			const original = runtime.sendMessage;
			runtime.sendMessage = async (message) => {
				const request = message as {
					type: string;
					data: {
						userId: string;
						kind: "category" | "nature";
						id: string;
						color: string | null;
					};
				};
				if (request.type === "savePersonalColor")
					await savePersonalColor(request.data.userId, request.data);
				return { res: undefined };
			};
			try {
				const row = env[kind];
				const { CategoryForm } = await import(
					"../../src/entrypoints/popup.settings/category-form"
				);
				const { NatureForm } = await import(
					"../../src/entrypoints/popup.settings/nature-form"
				);
				const editor =
					kind === "category"
						? React.createElement(CategoryForm, {
								mode: "edit",
								category:
									row as unknown as import("../../src/types/models").KeywordCategory,
								onClose() {},
							})
						: React.createElement(NatureForm, {
								mode: "edit",
								nature:
									row as unknown as import("../../src/types/models").KeywordNature,
								onClose() {},
							});
				const view = render(React.createElement(PageContent, null, editor), {
					wrapper,
				});
				expect(view.queryByLabelText("settings.nameEn")).toBeNull();
				expect(view.queryByLabelText("settings.originalColor")).toBeNull();
				expect(view.queryByRole("button", { name: "_.delete" })).toBeNull();
				const color = view.getByLabelText("settings.personalColor", {
					selector: "input",
				});
				const save = view.getByRole("button", { name: "_.save" });
				await waitFor(() => expect(color.hasAttribute("disabled")).toBe(false));
				fireEvent.change(color, { target: { value: "#abcdef" } });
				fireEvent.click(save);
				await waitFor(async () =>
					expect(
						(await readColorPreferences(guest.id)).colors[kind][row.id],
					).toBe("#abcdef"),
				);
				await waitFor(() => expect(save.hasAttribute("disabled")).toBe(true));
				fireEvent.click(
					view.getByRole("button", { name: "settings.clearPersonalColor" }),
				);
				await waitFor(async () =>
					expect(
						(await readColorPreferences(guest.id)).colors[kind][row.id],
					).toBeUndefined(),
				);
				expect(await env.db.mutations.count()).toBe(0);
				view.unmount();
			} finally {
				runtime.sendMessage = original;
			}
		});
	}
	it("lets moderators edit original and personal colors separately", async () => {
		env = await setupEngine({ moderator: true });
		store.set(authStateAtom, { user: env.user, token: "token-reader-1" });
		const { CategoryForm } = await import(
			"../../src/entrypoints/popup.settings/category-form"
		);
		const view = render(
			React.createElement(
				PageContent,
				null,
				React.createElement(CategoryForm, {
					mode: "edit",
					category:
						env.category as unknown as import("../../src/types/models").KeywordCategory,
					onClose() {},
				}),
			),
			{ wrapper },
		);
		expect(
			view.getByLabelText(/settings.originalColor/, { selector: "input" }),
		).toBeTruthy();
		expect(
			view.getByLabelText("settings.personalColor", { selector: "input" }),
		).toBeTruthy();
		expect(view.getByRole("button", { name: "_.delete" })).toBeTruthy();
		view.unmount();
	});
});

describe("manual image prompts", () => {
	const runtime = fakeBrowser.runtime as { sendMessage: unknown };
	let original: unknown;
	let clipboard: PropertyDescriptor | undefined;
	let requests: { type: string; data: Record<string, unknown> }[];
	beforeEach(async () => {
		original = runtime.sendMessage;
		clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
		requests = [];
		runtime.sendMessage = async (message: unknown) => {
			const item = message as { type: string; data: Record<string, unknown> };
			requests.push(item);
			if (item.type === "generateAiImage")
				return {
					res: {
						ok: false,
						failure: {
							code: "AI_PROVIDER_FAILED",
							message: "Image failed",
							details: {},
						},
					},
				};
			return { res: undefined };
		};
		env.novel.context = "A fantasy novel.";
		await fakeBrowser.storage.local.set({
			"storylens-ai-source": "desktop",
			"storylens-ai-image-source": "desktop",
			"storylens-desktop-client": {
				token: "paired",
				model: "gemini:test",
				effort: "default",
			},
			"storylens-ai-prompts": { imagePrompt: "Ink wash portrait." },
		});
	});
	afterEach(() => {
		cleanup();
		runtime.sendMessage = original;
		if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
		else Reflect.deleteProperty(navigator, "clipboard");
	});

	for (const source of ["desktop", "cloud"] as const) {
		it(`stops ${source} images immediately, ignores late results and allows retry`, async () => {
			await fakeBrowser.storage.local.set({
				"storylens-ai-image-source": source,
				"storylens-ai-pricing": {
					data: {
						cloudAi: { enabled: true },
						features: [{ key: "character_image", enabled: true, lenses: 1 }],
					},
				},
			});
			const pending: ((value: unknown) => void)[] = [];
			runtime.sendMessage = async (message: unknown) => {
				const item = message as { type: string; data: Record<string, unknown> };
				requests.push(item);
				if (item.type === "generateAiImage")
					return new Promise((resolve) => pending.push(resolve));
				return { res: undefined };
			};
			const { GenerateImageButton } = await import(
				"../../src/components/generate-image-button"
			);
			const files: File[] = [],
				busy: boolean[] = [];
			const view = render(
				React.createElement(GenerateImageButton, {
					novelId: env.novel.id,
					name: "Mira",
					description: "A scout.",
					autoStart: true,
					onGenerated(file) {
						files.push(file);
					},
					onBusyChange(value) {
						busy.push(value);
					},
				}),
				{ wrapper },
			);
			try {
				await waitFor(() => expect(pending).toHaveLength(1));
				const first = requests.find(
					(item) => item.type === "generateAiImage",
				)?.data;
				fireEvent.click(
					view.getByRole("button", { name: "coloring.stopImage" }),
				);
				expect(busy.at(-1)).toBe(false);
				expect(view.getByText("coloring.imageStopped")).toBeTruthy();
				expect(
					view.getByRole("button", { name: "coloring.copyImagePrompt" }),
				).toBeTruthy();
				expect(
					view.queryByRole("button", { name: "coloring.stopImage" }),
				).toBeNull();
				await waitFor(() =>
					expect(
						requests.some(
							(item) =>
								item.type === "cancelAiPrompt" &&
								(item.data as unknown) === first?.requestId,
						),
					).toBe(true),
				);
				fireEvent.click(
					view.getByRole("button", { name: /^coloring.generateImage/ }),
				);
				await waitFor(() => expect(pending).toHaveLength(2));
				await act(async () =>
					pending[0]({
						res: { ok: true, value: { data: "AA==", mimeType: "image/png" } },
					}),
				);
				expect(files).toHaveLength(0);
				expect(busy.at(-1)).toBe(true);
				expect(
					view.getByRole("button", { name: "coloring.stopImage" }),
				).toBeTruthy();
				await act(async () =>
					pending[1]({
						res: { ok: true, value: { data: "AA==", mimeType: "image/png" } },
					}),
				);
				await waitFor(() => expect(files).toHaveLength(1));
				expect(busy.at(-1)).toBe(false);
				expect(view.queryByText("coloring.imageStopped")).toBeNull();
			} finally {
				pending.forEach((resolve) => {
					resolve({ res: undefined });
				});
				view.unmount();
			}
		});
	}
	it("stops image preparation during novel research without starting an image request", async () => {
		env.novel.context = null;
		let finish: (value: unknown) => void = () => {};
		runtime.sendMessage = async (message: unknown) => {
			const item = message as { type: string; data: Record<string, unknown> };
			requests.push(item);
			if (item.type === "executeAiPrompt")
				return new Promise((resolve) => {
					finish = resolve;
				});
			return { res: undefined };
		};
		const { GenerateImageButton } = await import(
			"../../src/components/generate-image-button"
		);
		const view = render(
			React.createElement(GenerateImageButton, {
				novelId: env.novel.id,
				name: "Mira",
				description: "A scout.",
				onGenerated() {},
			}),
			{ wrapper },
		);
		try {
			fireEvent.click(
				view.getByRole("button", { name: /coloring.generateImage$/ }),
			);
			await waitFor(() =>
				expect(requests.some((item) => item.type === "executeAiPrompt")).toBe(
					true,
				),
			);
			const research = requests.find(
				(item) => item.type === "executeAiPrompt",
			)?.data;
			fireEvent.click(view.getByRole("button", { name: "coloring.stopImage" }));
			await waitFor(() =>
				expect(
					requests.some(
						(item) =>
							item.type === "cancelAiPrompt" &&
							(item.data as unknown) === research?.requestId,
					),
				).toBe(true),
			);
			await act(async () =>
				finish({ res: { ok: true, value: "A fantasy world." } }),
			);
			expect(requests.some((item) => item.type === "generateAiImage")).toBe(
				false,
			);
			expect(view.getByText("coloring.imageStopped")).toBeTruthy();
		} finally {
			finish({ res: undefined });
			view.unmount();
		}
	});
	it("keeps the submitted prompt copyable after failure and offers text when clipboard access fails", async () => {
		const { GenerateImageButton } = await import(
			"../../src/components/generate-image-button"
		);
		const view = render(
			React.createElement(GenerateImageButton, {
				novelId: env.novel.id,
				name: "Mira",
				description: "A red-haired scout.",
				onGenerated() {},
			}),
			{ wrapper },
		);
		fireEvent.click(
			view.getByRole("button", { name: /coloring.generateImage$/ }),
		);
		const copy = await view.findByRole("button", {
			name: "coloring.copyImagePrompt",
		});
		await waitFor(() =>
			expect(view.getByText(/coloring.imageGenerateFailed/)).toBeTruthy(),
		);
		const imageRequest = requests.find(
			(item) => item.type === "generateAiImage",
		)?.data;
		expect(imageRequest?.model).toBe("codex");
		expect(imageRequest?.prompt).toContain("Ink wash portrait.");
		expect(imageRequest?.prompt).toContain("A red-haired scout.");
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: async () => {
					throw new Error("blocked");
				},
			},
		});
		fireEvent.click(copy);
		const fallback = await view.findByLabelText("desktop.imagePrompt", {
			selector: "textarea",
		});
		const submittedPrompt = imageRequest?.prompt;
		if (typeof submittedPrompt !== "string")
			throw new Error("image prompt missing");
		expect((fallback as HTMLTextAreaElement).value).toBe(submittedPrompt);
		expect(
			requests.filter((item) => item.type === "generateAiImage"),
		).toHaveLength(1);
	});
	it("prepares the saved prompt without pairing or sending any AI request", async () => {
		await fakeBrowser.storage.local.remove("storylens-desktop-client");
		const { GenerateImageButton } = await import(
			"../../src/components/generate-image-button"
		);
		const view = render(
			React.createElement(GenerateImageButton, {
				novelId: env.novel.id,
				name: "Mira",
				description: "A scout.",
				onGenerated() {},
			}),
			{ wrapper },
		);
		fireEvent.click(
			view.getByRole("button", { name: /coloring.generateImage$/ }),
		);
		await waitFor(() =>
			expect(view.getByText(/coloring.imageGenerateFailed/)).toBeTruthy(),
		);
		const copied: string[] = [];
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: async (prompt: string) => {
					copied.push(prompt);
				},
			},
		});
		fireEvent.click(
			view.getByRole("button", { name: "coloring.copyImagePrompt" }),
		);
		await waitFor(() => expect(copied).toHaveLength(1));
		expect(copied[0]).toContain("Ink wash portrait.");
		expect(
			requests.some(
				(item) =>
					item.type === "generateAiImage" || item.type === "executeAiPrompt",
			),
		).toBe(false);
	});
});
