export type CloudAiFailure = {
	code: string;
	message: string;
	details: Record<string, unknown>;
};
export class CloudAiError extends Error {
	readonly code: string;
	readonly details: Record<string, unknown>;
	constructor(failure: CloudAiFailure) {
		super(failure.message);
		this.name = "CloudAiError";
		this.code = failure.code;
		this.details = failure.details;
	}
}
export type AiReply<T> =
	| { ok: true; value: T }
	| { ok: false; failure: CloudAiFailure };
export function unwrapAiReply<T>(reply: AiReply<T>): T {
	if (!reply.ok) throw new CloudAiError(reply.failure);
	return reply.value;
}
function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}
export function cloudFailure(status: number, body: unknown): CloudAiFailure {
	const data = record(body),
		error = record(data.error);
	const defaults: Record<number, string> = {
		401: "SIGNED_OUT",
		402: "INSUFFICIENT_LENSES",
		403: "REGISTERED_ACCOUNT_REQUIRED",
		404: "CLOUD_NOT_READY",
		413: "PROMPT_TOO_LARGE",
		426: "UPGRADE_REQUIRED",
		429: "AI_RATE_LIMITED",
		503: "AI_UNAVAILABLE",
	};
	const code =
		typeof error.code === "string"
			? error.code
			: (defaults[status] ?? "AI_PROVIDER_FAILED");
	return {
		code,
		message:
			status === 404
				? "Story Lens Cloud is not available yet. Try again later."
				: typeof error.message === "string"
					? error.message
					: "Story Lens Cloud could not complete this request.",
		details: {
			...record(error.details),
			...record(data.details),
			...(typeof data.balance === "number" ? { balance: data.balance } : {}),
			...(typeof data.refunded === "boolean"
				? { refunded: data.refunded }
				: {}),
		},
	};
}
export function serializeAiFailure(error: unknown): CloudAiFailure {
	if (error instanceof CloudAiError)
		return { code: error.code, message: error.message, details: error.details };
	return {
		code:
			error instanceof Error && error.name === "AbortError"
				? "AI_CANCELLED"
				: "NETWORK_ERROR",
		message:
			error instanceof Error
				? error.message
				: "Could not connect to Story Lens Cloud.",
		details: {},
	};
}
