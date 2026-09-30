import type { ConflictKind, Mutation } from "@/lib/offline/types";

/** What the transport got back: the server's row, or why there is none. */
export type TransportResult =
	| { ok: true; data: unknown }
	| {
			ok: false;
			status?: number;
			code?: string;
			body?: Record<string, unknown>;
			message?: string;
			network?: "offline" | "timeout" | "unknown";
			retryAfterMs?: number;
	  };

export type Outcome =
	| { type: "success"; data: unknown }
	| { type: "alreadyDone" }
	| { type: "stale"; current: Record<string, unknown> }
	| {
			type: "conflict";
			kind: ConflictKind;
			server?: Record<string, unknown> | null;
			message?: string;
	  }
	| {
			type: "rejected";
			kind: "rule" | "permission";
			message?: string;
			code?: string;
			hint?: "create-again";
	  }
	| {
			type: "transient";
			reason: "network" | "server";
			retryAfterMs?: number;
			message?: string;
	  }
	| { type: "auth" }
	| { type: "upgrade" };

const DUPLICATE_CODES = new Set([
	"UNIQUE_VIOLATION",
	"KEYWORD_NAME_TAKEN",
	"ALIAS_NAME_TAKEN",
	"REPLACEMENT_EXISTS",
	"LOOKUP_NAME_TAKEN",
]);

/**
 * Maps a send result to what happens next, following the API's statuses and
 * codes rather than its localized messages.
 */
export function classify(mutation: Mutation, result: TransportResult): Outcome {
	if (result.ok) return { type: "success", data: result.data };
	const { status, code, message } = result;
	if (status === undefined)
		return { type: "transient", reason: "network", message };
	if (status === 401) return { type: "auth" };
	if (status === 426) return { type: "upgrade" };
	if (status === 429 || status >= 500)
		return {
			type: "transient",
			reason: "server",
			retryAfterMs: result.retryAfterMs,
			message,
		};
	if (status === 404) {
		if (mutation.op === "delete") return { type: "alreadyDone" };
		if (mutation.op === "create" || code === "PARENT_NOT_FOUND")
			return { type: "conflict", kind: "parent-missing", message };
		return { type: "conflict", kind: "deleted", server: null, message };
	}
	if (
		status === 409 &&
		code === "STALE_WRITE" &&
		result.body?.current &&
		typeof result.body.current === "object"
	) {
		return {
			type: "stale",
			current: result.body.current as Record<string, unknown>,
		};
	}
	if (status === 409 && code && DUPLICATE_CODES.has(code))
		return { type: "conflict", kind: "duplicate", message };
	if (status === 409 && code === "ID_CONFLICT")
		return {
			type: "rejected",
			kind: "rule",
			message,
			code,
			hint: "create-again",
		};
	if (status === 403)
		return { type: "rejected", kind: "permission", message, code };
	if (status === 422) {
		// The client should never build such a request.
		console.error("[StoryLens] The API refused a malformed sync request", {
			entity: mutation.entity,
			op: mutation.op,
			code,
		});
	}
	return { type: "rejected", kind: "rule", message, code };
}
