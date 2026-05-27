import { sendMessage } from "@/entrypoints/background/messaging";
import type { ApiProxyRequest, ApiProxyResponse } from "@/types/api-proxy";

const LOG_PREFIX = "[StoryLens]";

function normalizeProxyUrl(url: string): string {
	if (url.startsWith("http://") || url.startsWith("https://")) {
		const parsed = new URL(url);
		return `${parsed.pathname}${parsed.search}`;
	}

	return url.startsWith("/") ? url : `/${url}`;
}

export async function proxyApiRequest<T>(
	request: ApiProxyRequest,
): Promise<ApiProxyResponse<T>> {
	const normalizedRequest: ApiProxyRequest = {
		...request,
		url: normalizeProxyUrl(request.url),
	};

	console.log(`${LOG_PREFIX} Proxy API request`, normalizedRequest);

	const response = await sendMessage("apiRequest", normalizedRequest);

	console.log(`${LOG_PREFIX} Proxy API response`, {
		ok: response.ok,
		status: response.status,
		url: normalizedRequest.url,
	});

	return response as ApiProxyResponse<T>;
}

export async function extensionApiGet<T>(
	url: string,
	params?: Record<string, unknown>,
): Promise<T> {
	const response = await proxyApiRequest<T>({
		url,
		method: "GET",
		params,
	});

	if (!response.ok) {
		console.error(`${LOG_PREFIX} Proxy API error body`, response.data);
		throw new Error(
			response.error ??
				`Extension API GET ${url} failed with status ${response.status}`,
		);
	}

	return response.data;
}

export async function extensionApiPost<T>(
	url: string,
	data?: unknown,
): Promise<T> {
	const response = await proxyApiRequest<T>({
		url,
		method: "POST",
		data,
		headers: { "Content-Type": "application/json" },
	});

	if (!response.ok) {
		console.error(`${LOG_PREFIX} Proxy API error body`, response.data);
		const apiMessage =
			typeof response.data === "object" &&
			response.data !== null &&
			"message" in response.data &&
			typeof response.data.message === "string"
				? response.data.message
				: undefined;

		throw new Error(
			apiMessage ??
				response.error ??
				`Extension API POST ${url} failed with status ${response.status}`,
		);
	}

	return response.data;
}
