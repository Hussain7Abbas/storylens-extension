import { env } from "@/env";
import { getStoredAuth } from "@/lib/auth/auth-storage";
import { desktopSettings } from "./settings";
import type {
	DesktopCapabilities,
	DesktopSettings,
	ExecutePromptInput,
	GeneratedImage,
	GenerateImageInput,
} from "./types";

const PROTOCOL_VERSION = 2;
const active = new Map<
	string,
	{ tabId: number; controller: AbortController }
>();
const encoder = new TextEncoder();

function isCapabilities(value: unknown): value is DesktopCapabilities {
	if (!value || typeof value !== "object") return false;
	const data = value as Partial<DesktopCapabilities>;
	return (
		data.protocolVersion === PROTOCOL_VERSION &&
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

/** Names the app to update when the client's capabilities fail validation. */
function incompatibleClientMessage(value: unknown): string {
	const version =
		value && typeof value === "object" && "protocolVersion" in value
			? value.protocolVersion
			: undefined;
	if (typeof version === "number" && version < PROTOCOL_VERSION)
		return `The Story Lens desktop client is outdated (protocol ${version}, needs ${PROTOCOL_VERSION}). Update and restart the desktop client, then connect again.`;
	if (typeof version === "number" && version > PROTOCOL_VERSION)
		return `The Story Lens extension is older than the desktop client (protocol ${PROTOCOL_VERSION}, client uses ${version}). Update the extension, then connect again.`;
	return "The desktop client sent an unexpected response. Check the port and make sure the Story Lens desktop client is running.";
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
	if (!isCapabilities(data)) throw new Error(incompatibleClientMessage(data));
	// Connecting also refreshes the account the desktop crawler uses; older clients lack the endpoint.
	void shareAccountSession().catch(() => {});
	return data;
}

/**
 * Shares the reader's Story Lens session (API URL and token) with the paired
 * desktop client, whose wiki crawler reads and saves novels with it. Signing
 * out shares `null`, which makes the client forget it.
 */
export async function shareAccountSession(): Promise<void> {
	const settings = await desktopSettings();
	if (!settings.token) return;
	const { token } = await getStoredAuth();
	await request("/AccountSession", settings, {
		method: "POST",
		signal: AbortSignal.timeout(10_000),
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			account: token ? { apiUrl: env.WXT_API_URL, token } : null,
		}),
	});
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

type ResultFrame = {
	type?: string;
	output?: string;
	mimeType?: string;
	data?: string;
	error?: { message?: string };
};

/** Reads an NDJSON job stream until its single result frame, enforcing a size limit. */
async function readResultFrame(
	response: Response,
	maxBytes: number,
): Promise<ResultFrame> {
	if (!response.body) throw new Error("Desktop client sent no response body.");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "",
		received = 0,
		result: ResultFrame | undefined;
	while (true) {
		const next = await reader.read();
		if (next.done) break;
		received += next.value.byteLength;
		if (received > maxBytes)
			throw new Error("Desktop client response exceeded the size limit.");
		buffer += decoder.decode(next.value, { stream: true });
		let newline = buffer.indexOf("\n");
		while (newline >= 0) {
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			if (line) {
				let frame: ResultFrame;
				try {
					frame = JSON.parse(line) as ResultFrame;
				} catch {
					throw new Error("Desktop client returned malformed data.");
				}
				if (result)
					throw new Error("Desktop client returned multiple results.");
				if (frame.type === "result") result = frame;
				else if (frame.type === "error")
					throw new Error(frame.error?.message ?? "Desktop client failed.");
				else if (frame.type !== "started" && frame.type !== "heartbeat")
					throw new Error("Desktop client returned an unknown event.");
			}
			newline = buffer.indexOf("\n");
		}
	}
	if (!result || buffer.trim())
		throw new Error("Desktop client connection ended before a result arrived.");
	return result;
}

/** Runs one streamed desktop job that can be canceled by request ID or by closing its tab. */
async function runDesktopJob<T>(
	path: string,
	requestId: string,
	tabId: number,
	body: Record<string, unknown>,
	options: { timeoutMs: number; maxBytes: number },
	pick: (frame: ResultFrame) => T,
): Promise<T> {
	const settings = await desktopSettings();
	if (active.has(requestId))
		throw new Error("This request is already running.");
	const controller = new AbortController();
	active.set(requestId, { tabId, controller });
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
	try {
		const response = await request(path, settings, {
			method: "POST",
			signal: controller.signal,
			headers: {
				"Content-Type": "application/json",
				Accept: "application/x-ndjson",
			},
			body: JSON.stringify(body),
		});
		return pick(await readResultFrame(response, options.maxBytes));
	} finally {
		clearTimeout(timeout);
		active.delete(requestId);
		controller.abort();
	}
}

export async function executeDesktopPrompt(
	data: ExecutePromptInput,
	tabId: number,
): Promise<string> {
	if (encoder.encode(data.prompt).byteLength > 500_000)
		throw new Error(
			"Prompt is too large for the desktop client (500 KB limit).",
		);
	return runDesktopJob(
		"/ExecutePrompt",
		data.requestId,
		tabId,
		{
			prompt: data.prompt,
			model: data.model,
			effort: data.effort,
			responseLanguage: data.responseLanguage,
			...(data.webSearch ? { webSearch: true } : {}),
		},
		{ timeoutMs: 245_000, maxBytes: 1_100_000 },
		(frame) => {
			if (typeof frame.output !== "string")
				throw new Error("Desktop client returned no answer.");
			return frame.output;
		},
	);
}

/** Asks the desktop client to draw one image with Codex; returns it as base64. */
export async function generateDesktopImage(
	data: GenerateImageInput,
	tabId: number,
): Promise<GeneratedImage> {
	if (encoder.encode(data.prompt).byteLength > 500_000)
		throw new Error(
			"Prompt is too large for the desktop client (500 KB limit).",
		);
	return runDesktopJob(
		"/GenerateImage",
		data.requestId,
		tabId,
		{ prompt: data.prompt, model: data.model, effort: data.effort },
		{ timeoutMs: 320_000, maxBytes: 12_000_000 },
		(frame) => {
			if (
				typeof frame.data !== "string" ||
				typeof frame.mimeType !== "string" ||
				!frame.mimeType.startsWith("image/")
			)
				throw new Error("Desktop client returned no image.");
			return { mimeType: frame.mimeType, data: frame.data };
		},
	);
}
