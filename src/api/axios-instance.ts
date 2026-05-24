import axios, {
	type AxiosError,
	type AxiosRequestConfig,
	type AxiosResponse,
} from "axios";

let configuredBaseUrl: string | undefined;

function resolveBaseUrl(): string {
	if (configuredBaseUrl) {
		return configuredBaseUrl;
	}

	const fromEnv =
		typeof process !== "undefined" ? process.env.WXT_API_URL : undefined;
	if (fromEnv) {
		return fromEnv;
	}

	throw new Error(
		"API base URL is not configured. Set WXT_API_URL or call configureApiClient().",
	);
}

export const axiosInstance = axios.create();

export function configureApiClient(baseUrl: string): void {
	configuredBaseUrl = baseUrl;
	axiosInstance.defaults.baseURL = baseUrl;
}

function toRelativeUrl(url: string): string {
	if (!url.startsWith("http://") && !url.startsWith("https://")) {
		return url;
	}

	const parsed = new URL(url);
	return `${parsed.pathname}${parsed.search}`;
}

function ensureConfigured(): void {
	axiosInstance.defaults.baseURL = resolveBaseUrl();
}

export const customInstance = <T>(
	config: AxiosRequestConfig,
	options?: AxiosRequestConfig,
): Promise<AxiosResponse<T>> => {
	ensureConfigured();

	const source = axios.CancelToken.source();
	const promise = axiosInstance({
		...config,
		...(config.url ? { url: toRelativeUrl(String(config.url)) } : {}),
		...options,
		cancelToken: source.token,
	});

	// @ts-expect-error Orval query cancellation support
	promise.cancel = () => {
		source.cancel("Query was cancelled");
	};

	return promise;
};

export type ErrorType<Error> = AxiosError<Error>;
