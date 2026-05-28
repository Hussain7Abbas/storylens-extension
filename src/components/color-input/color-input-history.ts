const STORAGE_KEY = "storylens:color-history";
const MAX_HISTORY = 14;
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

type ColorHistoryListener = () => void;

const listeners = new Set<ColorHistoryListener>();
const EMPTY_HISTORY: string[] = [];

let cachedStorageValue: string | null | undefined;
let cachedSnapshot: string[] = EMPTY_HISTORY;

function subscribe(listener: ColorHistoryListener) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function notifyListeners() {
	for (const listener of listeners) {
		listener();
	}
}

export function normalizeHexColor(color: string): string | null {
	const trimmed = color.trim();
	if (!HEX_COLOR_REGEX.test(trimmed)) {
		return null;
	}

	return trimmed.toUpperCase();
}

function parseStoredHistory(raw: string | null): string[] {
	if (!raw) {
		return [];
	}

	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			return [];
		}

		return parsed.flatMap((entry) => {
			if (typeof entry !== "string") {
				return [];
			}

			const normalized = normalizeHexColor(entry);
			return normalized ? [normalized] : [];
		});
	} catch {
		return [];
	}
}

function setCachedSnapshot(raw: string | null, history: string[]) {
	cachedStorageValue = raw;
	cachedSnapshot = history.length === 0 ? EMPTY_HISTORY : history;
}

function refreshCachedSnapshot(): string[] {
	let raw: string | null;

	try {
		raw = localStorage.getItem(STORAGE_KEY);
	} catch {
		setCachedSnapshot(null, []);
		return cachedSnapshot;
	}

	if (raw === cachedStorageValue) {
		return cachedSnapshot;
	}

	setCachedSnapshot(raw, parseStoredHistory(raw));
	return cachedSnapshot;
}

export function readColorHistory(): string[] {
	return refreshCachedSnapshot();
}

export function getColorHistoryServerSnapshot(): string[] {
	return EMPTY_HISTORY;
}

export function addColorToHistory(color: string): string[] {
	const normalized = normalizeHexColor(color);
	if (!normalized) {
		return readColorHistory();
	}

	const history = [...readColorHistory()].filter(
		(entry) => entry !== normalized,
	);
	const nextHistory = [normalized, ...history].slice(0, MAX_HISTORY);
	const serialized = JSON.stringify(nextHistory);

	localStorage.setItem(STORAGE_KEY, serialized);
	setCachedSnapshot(serialized, nextHistory);
	notifyListeners();

	return cachedSnapshot;
}

export function subscribeToColorHistory(listener: ColorHistoryListener) {
	return subscribe(listener);
}
