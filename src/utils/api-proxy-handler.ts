import type { AxiosError } from "axios";
import { customInstance } from "@/api/axios-instance";
import type { ApiProxyRequest, ApiProxyResponse } from "@/types/api-proxy";

const LOG_PREFIX = "[StoryLens]";

function toProxyError(error: unknown): ApiProxyResponse {
	const axiosError = error as AxiosError;

	if (axiosError.response) {
		return {
			ok: false,
			status: axiosError.response.status,
			data: axiosError.response.data,
			error: axiosError.message,
		};
	}

	const message =
		error instanceof Error ? error.message : "Unknown API proxy error";

	return {
		ok: false,
		status: 0,
		data: null,
		error: message,
	};
}

export async function handleApiProxyRequest<T = unknown>(
	request: ApiProxyRequest,
): Promise<ApiProxyResponse<T>> {
	console.log(`${LOG_PREFIX} Background API proxy`, request);

	try {
		const response = await customInstance<T>({
			url: request.url,
			method: request.method,
			params: request.params,
			data: request.data,
			headers: request.headers,
		});

		return {
			ok: true,
			status: response.status,
			data: response.data,
		};
	} catch (error) {
		console.error(`${LOG_PREFIX} Background API proxy failed`, error);
		return toProxyError(error) as ApiProxyResponse<T>;
	}
}
