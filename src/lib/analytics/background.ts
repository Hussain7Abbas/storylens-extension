import { browser } from "#imports";
import { env } from "@/env";
import {
	ANALYTICS_ENABLED_KEY,
	type AnalyticsEvent,
} from "@/lib/analytics/types";

// GA4 Measurement Protocol: MV3 forbids remotely hosted code, so gtag.js
// cannot be loaded and events are posted from the service worker instead.
const COLLECT_URL = "https://www.google-analytics.com/mp/collect";
const DEBUG_COLLECT_URL = "https://www.google-analytics.com/debug/mp/collect";
const CLIENT_ID_KEY = "storylens-analytics-client-id";
const SESSION_KEY = "storylens-analytics-session";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_ENGAGEMENT_TIME_MSEC = 100;

type AnalyticsSession = { id: string; lastActiveAt: number };

function isConfigured(): boolean {
	return !!env.WXT_GA_MEASUREMENT_ID && !!env.WXT_GA_API_SECRET;
}

async function isEnabled(): Promise<boolean> {
	const stored = await browser.storage.local.get(ANALYTICS_ENABLED_KEY);
	return stored[ANALYTICS_ENABLED_KEY] !== false;
}

async function getClientId(): Promise<string> {
	const stored = await browser.storage.local.get(CLIENT_ID_KEY);
	const existing = stored[CLIENT_ID_KEY];
	if (typeof existing === "string") {
		return existing;
	}

	const clientId = crypto.randomUUID();
	await browser.storage.local.set({ [CLIENT_ID_KEY]: clientId });
	return clientId;
}

function isSession(value: unknown): value is AnalyticsSession {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as AnalyticsSession).id === "string" &&
		typeof (value as AnalyticsSession).lastActiveAt === "number"
	);
}

async function getSessionId(): Promise<string> {
	const now = Date.now();
	const stored = await browser.storage.session.get(SESSION_KEY);
	const current = stored[SESSION_KEY];
	const session: AnalyticsSession =
		isSession(current) && now - current.lastActiveAt < SESSION_TIMEOUT_MS
			? { id: current.id, lastActiveAt: now }
			: { id: String(now), lastActiveAt: now };

	await browser.storage.session.set({ [SESSION_KEY]: session });
	return session.id;
}

export async function trackAnalyticsEvent(
	event: AnalyticsEvent,
): Promise<void> {
	if (!isConfigured() || !(await isEnabled())) {
		return;
	}

	try {
		const [clientId, sessionId] = await Promise.all([
			getClientId(),
			getSessionId(),
		]);
		const url = new URL(import.meta.env.DEV ? DEBUG_COLLECT_URL : COLLECT_URL);
		url.searchParams.set("measurement_id", env.WXT_GA_MEASUREMENT_ID ?? "");
		url.searchParams.set("api_secret", env.WXT_GA_API_SECRET ?? "");

		const response = await fetch(url, {
			method: "POST",
			body: JSON.stringify({
				client_id: clientId,
				events: [
					{
						name: event.name,
						params: {
							session_id: sessionId,
							engagement_time_msec: DEFAULT_ENGAGEMENT_TIME_MSEC,
							extension_version: browser.runtime.getManifest().version,
							...event.params,
						},
					},
				],
			}),
		});

		if (import.meta.env.DEV) {
			console.log(
				"[StoryLens] Analytics validation",
				event.name,
				await response.json(),
			);
		}
	} catch (error) {
		console.warn("[StoryLens] Failed to send analytics event", error);
	}
}
