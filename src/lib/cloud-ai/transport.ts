import { CloudAiError, cloudFailure } from "./errors";
import { type CloudFrame, readCloudFrame } from "./frames";
/** Transport dependencies are injected to test real streams, cancellation and compatibility without browser mocks. */
export async function cloudRequest(
	input: {
		url: string;
		body: Record<string, unknown>;
		token: string;
		language: string;
		version: string | null;
		signal: AbortSignal;
		maxBytes: number;
	},
	dependencies: {
		fetch: (url: string, init: RequestInit) => Promise<Response>;
		onFrame: (frame: CloudFrame) => Promise<void>;
		onUpgrade: () => Promise<void>;
	},
): Promise<CloudFrame> {
	const response = await dependencies.fetch(input.url, {
		method: "POST",
		cache: "no-store",
		credentials: "omit",
		signal: input.signal,
		headers: {
			"Content-Type": "application/json",
			Accept: "application/x-ndjson",
			Authorization: `Bearer ${input.token}`,
			"Accept-Language": input.language,
			...(input.version ? { "X-Client-Version": input.version } : {}),
		},
		body: JSON.stringify(input.body),
	});
	if (!response.ok) {
		if (response.status === 426) await dependencies.onUpgrade();
		const failure = cloudFailure(
			response.status,
			await response.json().catch(() => null),
		);
		if (typeof failure.details.balance === "number")
			await dependencies.onFrame({
				type: "error",
				balance: failure.details.balance,
			});
		throw new CloudAiError(failure);
	}
	return readCloudFrame(response, input.maxBytes, dependencies.onFrame);
}
