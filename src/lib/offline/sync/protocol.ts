import { getSyncProtocol } from "@/api/generated/endpoints/sync";
import type { StoryLensDatabase } from "@/lib/offline/db";
import { getMeta, setMeta } from "@/lib/offline/meta";
import { REQUEST_TIMEOUT_MS, toResult } from "./transport";

/** The sync contract this build speaks; older APIs answer 404 or a lower version. */
export const REQUIRED_PROTOCOL = 2;
const OK_CACHE_MS = 60 * 60 * 1000;
const OUTDATED_CACHE_MS = 5 * 60 * 1000;

export type ProtocolCheck = "ok" | "outdated" | "network" | "auth" | "upgrade";

/**
 * Checks that the API speaks this build's sync protocol, cached in `syncMeta`
 * (an hour when it does, five minutes when it does not). During store review
 * the new extension meets the old API: the runner then sends nothing and keeps
 * every change until the backend deploys.
 */
export async function checkProtocol(
	db: StoryLensDatabase,
	{
		token,
		signal,
		now = Date.now(),
		force = false,
	}: { token: string; signal?: AbortSignal; now?: number; force?: boolean },
): Promise<ProtocolCheck> {
	const cached = await getMeta("protocol", db);
	if (cached && !force) {
		const ok = (cached.version ?? 0) >= REQUIRED_PROTOCOL;
		if (now - cached.checkedAt < (ok ? OK_CACHE_MS : OUTDATED_CACHE_MS))
			return ok ? "ok" : "outdated";
	}
	const result = await toResult(() =>
		getSyncProtocol({
			timeout: REQUEST_TIMEOUT_MS,
			signal,
			headers: { Authorization: `Bearer ${token}` },
		}),
	);
	if (result.ok) {
		const version =
			typeof (result.data as { version?: unknown })?.version === "number"
				? (result.data as { version: number }).version
				: null;
		await setMeta("protocol", { version, checkedAt: now }, db);
		return (version ?? 0) >= REQUIRED_PROTOCOL ? "ok" : "outdated";
	}
	if (result.status === 401) return "auth";
	if (result.status === 426) return "upgrade";
	if (result.status === 404) {
		await setMeta("protocol", { version: null, checkedAt: now }, db);
		return "outdated";
	}
	return "network";
}
