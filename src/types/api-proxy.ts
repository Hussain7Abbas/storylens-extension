export type ApiProxyMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export type ApiProxyRequest = {
	url: string;
	method: ApiProxyMethod;
	params?: Record<string, unknown>;
	data?: unknown;
	headers?: Record<string, string>;
};

export type ApiProxyResponse<T = unknown> = {
	ok: boolean;
	status: number;
	data: T;
	error?: string;
};
