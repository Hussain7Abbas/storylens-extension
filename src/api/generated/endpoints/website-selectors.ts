import type {
	UseMutationOptions,
	UseMutationResult,
	UseQueryOptions,
	UseQueryResult,
} from "@tanstack/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ErrorType } from "../../axios-instance";
import { customInstance } from "../../axios-instance";
import type {
	GetWebsiteSelectors200,
	WebsiteSelectorBody,
	WebsiteSelectorResponse,
	WebsiteSelectorUpdateBody,
} from "../schemas/website-selector";

type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];

export const getWebsiteSelectors = (
	options?: SecondParameter<typeof customInstance>,
	signal?: AbortSignal,
) => {
	return customInstance<GetWebsiteSelectors200>(
		{ url: "/website-selectors/", method: "GET", signal },
		options,
	);
};

export const getGetWebsiteSelectorsQueryKey = () => {
	return ["/website-selectors/"] as const;
};

export function useGetWebsiteSelectors<
	TData = Awaited<ReturnType<typeof getWebsiteSelectors>>,
>(
	options?: {
		query?: Partial<
			UseQueryOptions<
				Awaited<ReturnType<typeof getWebsiteSelectors>>,
				ErrorType<unknown>,
				TData
			>
		>;
		request?: SecondParameter<typeof customInstance>;
	},
): UseQueryResult<TData, ErrorType<unknown>> {
	const { query: queryOptions, request: requestOptions } = options ?? {};

	return useQuery({
		queryKey: queryOptions?.queryKey ?? getGetWebsiteSelectorsQueryKey(),
		queryFn: ({ signal }) => getWebsiteSelectors(requestOptions, signal),
		...queryOptions,
	});
}

export const getWebsiteSelectorsByWebsite = (
	website: string,
	options?: SecondParameter<typeof customInstance>,
	signal?: AbortSignal,
) => {
	return customInstance<WebsiteSelectorResponse>(
		{
			url: `/website-selectors/${encodeURIComponent(website)}`,
			method: "GET",
			signal,
		},
		options,
	);
};

export const getGetWebsiteSelectorsByWebsiteQueryKey = (website?: string) => {
	return [`/website-selectors/${website}`] as const;
};

export function useGetWebsiteSelectorsByWebsite<
	TData = Awaited<ReturnType<typeof getWebsiteSelectorsByWebsite>>,
>(
	website: string,
	options?: {
		query?: Partial<
			UseQueryOptions<
				Awaited<ReturnType<typeof getWebsiteSelectorsByWebsite>>,
				ErrorType<unknown>,
				TData
			>
		>;
		request?: SecondParameter<typeof customInstance>;
	},
): UseQueryResult<TData, ErrorType<unknown>> {
	const { query: queryOptions, request: requestOptions } = options ?? {};

	return useQuery({
		queryKey:
			queryOptions?.queryKey ??
			getGetWebsiteSelectorsByWebsiteQueryKey(website),
		queryFn: ({ signal }) =>
			getWebsiteSelectorsByWebsite(website, requestOptions, signal),
		enabled: !!website,
		...queryOptions,
	});
}

export const postWebsiteSelectors = (
	body: WebsiteSelectorBody,
	options?: SecondParameter<typeof customInstance>,
) => {
	return customInstance<WebsiteSelectorResponse>(
		{ url: "/website-selectors/", method: "POST", data: body },
		options,
	);
};

export function usePostWebsiteSelectors(
	options?: {
		mutation?: UseMutationOptions<
			Awaited<ReturnType<typeof postWebsiteSelectors>>,
			ErrorType<unknown>,
			{ data: WebsiteSelectorBody }
		>;
		request?: SecondParameter<typeof customInstance>;
	},
): UseMutationResult<
	Awaited<ReturnType<typeof postWebsiteSelectors>>,
	ErrorType<unknown>,
	{ data: WebsiteSelectorBody }
> {
	const { mutation: mutationOptions, request: requestOptions } = options ?? {};

	return useMutation({
		mutationFn: ({ data }) => postWebsiteSelectors(data, requestOptions),
		...mutationOptions,
	});
}

export const putWebsiteSelectorsByWebsite = (
	website: string,
	body: WebsiteSelectorUpdateBody,
	options?: SecondParameter<typeof customInstance>,
) => {
	return customInstance<WebsiteSelectorResponse>(
		{
			url: `/website-selectors/${encodeURIComponent(website)}`,
			method: "PUT",
			data: body,
		},
		options,
	);
};

export function usePutWebsiteSelectorsByWebsite(
	options?: {
		mutation?: UseMutationOptions<
			Awaited<ReturnType<typeof putWebsiteSelectorsByWebsite>>,
			ErrorType<unknown>,
			{ website: string; data: WebsiteSelectorUpdateBody }
		>;
		request?: SecondParameter<typeof customInstance>;
	},
): UseMutationResult<
	Awaited<ReturnType<typeof putWebsiteSelectorsByWebsite>>,
	ErrorType<unknown>,
	{ website: string; data: WebsiteSelectorUpdateBody }
> {
	const { mutation: mutationOptions, request: requestOptions } = options ?? {};

	return useMutation({
		mutationFn: ({ website, data }) =>
			putWebsiteSelectorsByWebsite(website, data, requestOptions),
		...mutationOptions,
	});
}

export const deleteWebsiteSelectorsByWebsite = (
	website: string,
	options?: SecondParameter<typeof customInstance>,
) => {
	return customInstance<WebsiteSelectorResponse>(
		{
			url: `/website-selectors/${encodeURIComponent(website)}`,
			method: "DELETE",
		},
		options,
	);
};

export function useDeleteWebsiteSelectorsByWebsite(
	options?: {
		mutation?: UseMutationOptions<
			Awaited<ReturnType<typeof deleteWebsiteSelectorsByWebsite>>,
			ErrorType<unknown>,
			{ website: string }
		>;
		request?: SecondParameter<typeof customInstance>;
	},
): UseMutationResult<
	Awaited<ReturnType<typeof deleteWebsiteSelectorsByWebsite>>,
	ErrorType<unknown>,
	{ website: string }
> {
	const { mutation: mutationOptions, request: requestOptions } = options ?? {};

	return useMutation({
		mutationFn: ({ website }) =>
			deleteWebsiteSelectorsByWebsite(website, requestOptions),
		...mutationOptions,
	});
}
