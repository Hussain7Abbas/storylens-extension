import { browser } from "#imports";
import type {
	DesktopCapabilities,
	DesktopSettings,
	ExecutePromptInput,
} from "./types";
import { DESKTOP_SETTINGS_KEY } from "./types";

const active = new Map<
	string,
	{ tabId: number; controller: AbortController }
>();
const encoder = new TextEncoder();

function isCapabilities(value: unknown): value is DesktopCapabilities {
	if (!value || typeof value !== "object") return false;
	const data = value as Partial<DesktopCapabilities>;
	return (
		data.protocolVersion === 2 &&
		Array.isArray(data.models) &&
		data.models.every(
			(model) =>
				typeof model.id === "string" &&
				Array.isArray(model.efforts) &&
				typeof model.provider === "string",
		) &&
		!!data.limits &&
		Number.isSafeInteger(data.limits.promptBytes)
	);
}

export async function desktopSettings(): Promise<DesktopSettings> {
	const stored = (await browser.storage.local.get(DESKTOP_SETTINGS_KEY))[
		DESKTOP_SETTINGS_KEY
	] as Partial<DesktopSettings> | undefined;
	return {
		port: stored?.port ?? 43127,
		token: stored?.token ?? "",
		model: stored?.model ?? "",
		effort: stored?.effort ?? "",
	};
}

async function request(
	path: string,
	settings: DesktopSettings,
	init: RequestInit = {},
): Promise<Response> {
	if (
		!Number.isInteger(settings.port) ||
		settings.port < 1024 ||
		settings.port > 65535 ||
		!settings.token
	)
		throw new Error("Pair the desktop client in extension settings first.");
	const response = await fetch(`http://127.0.0.1:${settings.port}${path}`, {
		...init,
		headers: { Authorization: `Bearer ${settings.token}`, ...init.headers },
		cache: "no-store",
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as {
			error?: { message?: string };
		} | null;
		throw new Error(
			body?.error?.message ??
				`Desktop client returned HTTP ${response.status}.`,
		);
	}
	return response;
}

export async function loadDesktopCapabilities(): Promise<DesktopCapabilities> {
	const response = await request("/capabilities", await desktopSettings(), {
		signal: AbortSignal.timeout(20_000),
	});
	const data: unknown = await response.json();
	if (!isCapabilities(data))
		throw new Error("Desktop client protocol is incompatible.");
	return data;
}

export function cancelTabPrompts(tabId: number): void {
	for (const [id, job] of active)
		if (job.tabId === tabId) {
			job.controller.abort();
			active.delete(id);
		}
}
export function cancelPrompt(requestId: string, tabId: number): void {
	const job = active.get(requestId);
	if (job?.tabId === tabId) {
		job.controller.abort();
		active.delete(requestId);
	}
}

export async function executeDesktopPrompt(
	data: ExecutePromptInput,
	tabId: number,
): Promise<string> {
	const settings = await desktopSettings();
	if (active.has(data.requestId))
		throw new Error("This request is already running.");
	if (encoder.encode(data.prompt).byteLength > 500_000)
		throw new Error("Page is too large to summarize (500 KB limit).");
	const controller = new AbortController();
	active.set(data.requestId, { tabId, controller });
	const timeout = setTimeout(() => controller.abort(), 245_000);
	try {
		const response = await request("/ExecutePrompt", settings, {
			method: "POST",
			signal: controller.signal,
			headers: {
				"Content-Type": "application/json",
				Accept: "application/x-ndjson",
			},
			body: JSON.stringify({
				prompt: data.prompt,
				model: data.model,
				effort: data.effort,
				responseLanguage: data.responseLanguage,
			}),
		});
		if (!response.body)
			throw new Error("Desktop client sent no response body.");
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "",
			received = 0,
			terminal = false,
			output = "";
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			received += next.value.byteLength;
			if (received > 1_100_000)
				throw new Error("Desktop client response exceeded the size limit.");
			buffer += decoder.decode(next.value, { stream: true });
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				if (line) {
					let frame: {
						type?: string;
						output?: string;
						error?: { message?: string };
					};
					try {
						frame = JSON.parse(line) as typeof frame;
					} catch {
						throw new Error("Desktop client returned malformed data.");
					}
					if (terminal)
						throw new Error("Desktop client returned multiple results.");
					if (frame.type === "result") {
						if (typeof frame.output !== "string")
							throw new Error("Desktop client returned no answer.");
						output = frame.output;
						terminal = true;
					} else if (frame.type === "error")
						throw new Error(frame.error?.message ?? "Desktop client failed.");
					else if (frame.type !== "started" && frame.type !== "heartbeat")
						throw new Error("Desktop client returned an unknown event.");
				}
				newline = buffer.indexOf("\n");
			}
		}
		if (!terminal || buffer.trim())
			throw new Error(
				"Desktop client connection ended before a result arrived.",
			);
		return output;
	} finally {
		clearTimeout(timeout);
		active.delete(data.requestId);
		controller.abort();
	}
}
