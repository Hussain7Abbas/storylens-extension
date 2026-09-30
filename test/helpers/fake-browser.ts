/// <reference types="bun" />
import { mock } from "bun:test";

type Listener<T extends unknown[]> = (...args: T) => void;

function event<T extends unknown[]>() {
	const listeners = new Set<Listener<T>>();
	return {
		addListener: (listener: Listener<T>) => listeners.add(listener),
		removeListener: (listener: Listener<T>) => listeners.delete(listener),
		hasListener: (listener: Listener<T>) => listeners.has(listener),
		emit: (...args: T) => {
			for (const listener of [...listeners]) listener(...args);
		},
		clear: () => listeners.clear(),
	};
}

/** One macrotask, so concurrent storage calls interleave as they do in real extensions. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;
const storageChanged = event<[Changes, string]>();

function storageArea(areaName: "local" | "session") {
	let data = new Map<string, unknown>();
	const onChanged = event<[Changes]>();
	const notify = (changes: Changes) => {
		if (!Object.keys(changes).length) return;
		onChanged.emit(changes);
		storageChanged.emit(changes, areaName);
	};
	return {
		onChanged,
		async get(keys?: string | string[] | Record<string, unknown> | null) {
			await tick();
			const wanted =
				keys === undefined || keys === null
					? [...data.keys()]
					: typeof keys === "string"
						? [keys]
						: Array.isArray(keys)
							? keys
							: Object.keys(keys);
			const out: Record<string, unknown> = {};
			for (const key of wanted)
				if (data.has(key)) out[key] = structuredClone(data.get(key));
			return out;
		},
		async set(values: Record<string, unknown>) {
			await tick();
			const changes: Changes = {};
			for (const [key, value] of Object.entries(values)) {
				changes[key] = { oldValue: data.get(key), newValue: value };
				data.set(key, structuredClone(value));
			}
			notify(changes);
		},
		async remove(keys: string | string[]) {
			await tick();
			const changes: Changes = {};
			for (const key of typeof keys === "string" ? [keys] : keys) {
				if (data.has(key)) changes[key] = { oldValue: data.get(key) };
				data.delete(key);
			}
			notify(changes);
		},
		async clear() {
			data = new Map();
		},
		/** Test access without the async tick. */
		peek: (key: string) => data.get(key),
		reset: () => {
			data = new Map();
			onChanged.clear();
		},
	};
}

type Alarm = { name: string; scheduledTime: number; periodInMinutes?: number };

function alarmsApi() {
	const alarms = new Map<string, Alarm>();
	const onAlarm = event<[Alarm]>();
	return {
		onAlarm,
		created: [] as Alarm[],
		async create(
			name: string,
			info: {
				when?: number;
				delayInMinutes?: number;
				periodInMinutes?: number;
			},
		) {
			const delay = info.delayInMinutes ?? info.periodInMinutes ?? 0;
			const alarm: Alarm = {
				name,
				scheduledTime: info.when ?? Date.now() + delay * 60_000,
				periodInMinutes: info.periodInMinutes,
			};
			alarms.set(name, alarm);
			this.created.push(alarm);
		},
		async get(name: string) {
			return alarms.get(name);
		},
		async getAll() {
			return [...alarms.values()];
		},
		async clear(name: string) {
			return alarms.delete(name);
		},
		reset() {
			alarms.clear();
			onAlarm.clear();
			this.created = [];
		},
	};
}

export const fakeBrowser = {
	storage: {
		local: storageArea("local"),
		session: storageArea("session"),
		onChanged: storageChanged,
	},
	alarms: alarmsApi(),
	runtime: {
		id: "storylens-test",
		getURL: (path: string) =>
			`chrome-extension://storylens-test${path.startsWith("/") ? path : `/${path}`}`,
		getManifest: () => ({ version: "4.0.0" }),
		onStartup: event<[]>(),
		onInstalled: event<[{ reason: string; previousVersion?: string }]>(),
		onMessage: event<[unknown]>(),
		requestUpdateCheck: async () => ({ status: "no_update" }),
		reload: () => {},
		sendMessage: async () => undefined,
	},
	tabs: {
		open: [] as { id: number; url?: string }[],
		sent: [] as { tabId: number; message: unknown }[],
		async query() {
			return this.open;
		},
		async sendMessage(tabId: number, message: unknown) {
			this.sent.push({ tabId, message });
		},
		onRemoved: event<[number]>(),
	},
	action: {
		badge: { text: "", color: "", title: "" },
		async setBadgeText({ text }: { text: string }) {
			fakeBrowser.action.badge.text = text;
		},
		async setBadgeBackgroundColor({ color }: { color: string }) {
			fakeBrowser.action.badge.color = color;
		},
		async setTitle({ title }: { title: string }) {
			fakeBrowser.action.badge.title = title;
		},
	},
};

export function resetFakeBrowser(): void {
	fakeBrowser.storage.local.reset();
	fakeBrowser.storage.session.reset();
	storageChanged.clear();
	fakeBrowser.alarms.reset();
	fakeBrowser.tabs.open = [];
	fakeBrowser.tabs.sent = [];
	fakeBrowser.action.badge = { text: "", color: "", title: "" };
}

mock.module("#imports", () => ({ browser: fakeBrowser }));
