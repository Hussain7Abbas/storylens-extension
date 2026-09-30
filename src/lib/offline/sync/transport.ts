import { type AxiosRequestConfig, isAxiosError, isCancel } from "axios";
import { customInstance } from "@/api/axios-instance";
import {
	deleteKeywordCategoriesById,
	postKeywordCategories,
	putKeywordCategoriesById,
} from "@/api/generated/endpoints/keyword-categories";
import {
	deleteKeywordNaturesById,
	postKeywordNatures,
	putKeywordNaturesById,
} from "@/api/generated/endpoints/keyword-natures";
import {
	deleteKeywordAliasesById,
	deleteKeywordsById,
	deleteKeywordVersionsById,
	postKeywordAliases,
	postKeywords,
	postKeywordVersions,
	putKeywordAliasesById,
	putKeywordsById,
	putKeywordVersionsById,
} from "@/api/generated/endpoints/keywords";
import {
	deleteReplacementsById,
	postReplacements,
	putReplacementsById,
} from "@/api/generated/endpoints/replacements";
import type {
	PostFilesUpload200,
	PostKeywordAliasesBodyOne,
	PostKeywordCategoriesBodyOne,
	PostKeywordNaturesBodyOne,
	PostKeywordsBodyOne,
	PostKeywordVersionsBodyOne,
	PostReplacementsBodyOne,
	PutKeywordAliasesByIdBodyOne,
	PutKeywordCategoriesByIdBodyOne,
	PutKeywordNaturesByIdBodyOne,
	PutKeywordsByIdBodyOne,
	PutKeywordVersionsByIdBodyOne,
	PutReplacementsByIdBodyOne,
} from "@/api/generated/schemas";
import { offlineDb, type StoryLensDatabase } from "@/lib/offline/db";
import type { Mutation } from "@/lib/offline/types";
import type { TransportResult } from "./classify";

/** Every sync request gives up after this long. */
export const REQUEST_TIMEOUT_MS = 20_000;
export const UPLOAD_TIMEOUT_MS = 60_000;

export type SendOptions = {
	signal?: AbortSignal;
	token: string;
	db?: StoryLensDatabase;
};

type Body = Record<string, unknown>;

/** A create's body: its fields and the client ID. */
function createBody(mutation: Mutation): Body {
	return { ...mutation.patch, id: mutation.entityId };
}

/** An update's body: only the changed fields (cleared ones as null) and the base `updatedAt`. */
function updateBody(mutation: Mutation): Body {
	return { ...mutation.patch, baseUpdatedAt: mutation.baseUpdatedAt };
}

function parseRetryAfter(value: unknown): number | undefined {
	if (typeof value !== "string" && typeof value !== "number") return undefined;
	const seconds = Number(value);
	if (!Number.isNaN(seconds)) return seconds * 1000;
	const date = Date.parse(String(value));
	return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** Turns a request outcome into a `TransportResult`; the only place that reads Axios errors. */
export async function toResult(
	request: () => Promise<{ data: unknown }>,
): Promise<TransportResult> {
	try {
		const response = await request();
		return { ok: true, data: response.data };
	} catch (error) {
		if (isCancel(error))
			return { ok: false, network: "timeout", message: "Canceled" };
		if (!isAxiosError(error))
			return {
				ok: false,
				network: "unknown",
				message: error instanceof Error ? error.message : String(error),
			};
		const response = error.response;
		if (!response) {
			const timeout =
				error.code === "ECONNABORTED" ||
				error.code === "ETIMEDOUT" ||
				error.code === "ERR_CANCELED";
			return {
				ok: false,
				network: timeout ? "timeout" : "offline",
				message: error.message,
			};
		}
		const body = (
			typeof response.data === "object" && response.data !== null
				? response.data
				: {}
		) as Record<string, unknown>;
		const headers = response.headers as Record<string, unknown> & {
			get?: (name: string) => unknown;
		};
		return {
			ok: false,
			status: response.status,
			code: typeof body.code === "string" ? body.code : undefined,
			body,
			message: typeof body.message === "string" ? body.message : error.message,
			retryAfterMs: parseRetryAfter(
				headers["retry-after"] ?? headers.get?.("retry-after"),
			),
		};
	}
}

async function upload(
	mutation: Mutation,
	options: AxiosRequestConfig,
	db: StoryLensDatabase,
): Promise<{ data: unknown }> {
	const file = await db.files.get(mutation.entityId);
	if (!file) throw new Error("Queued image is missing");
	const form = new FormData();
	form.append("id", mutation.entityId);
	form.append("type", "Image");
	form.append("file", new File([file.blob], file.name, { type: file.type }));
	return customInstance<PostFilesUpload200>(
		{ url: "/api/user/files/upload", method: "POST", data: form },
		{ ...options, timeout: UPLOAD_TIMEOUT_MS },
	);
}

/**
 * Sends one mutation. This is the only module that calls write endpoints for
 * syncable entities (architecture invariant 1). Each request carries the
 * account's own token, a timeout and the run's abort signal.
 */
export async function send(
	mutation: Mutation,
	{ signal, token, db = offlineDb() }: SendOptions,
): Promise<TransportResult> {
	const options: AxiosRequestConfig = {
		timeout: REQUEST_TIMEOUT_MS,
		signal,
		headers: { Authorization: `Bearer ${token}` },
	};
	const id = mutation.entityId;
	const { op } = mutation;
	// The outbox holds each body's fields; the generated types name the request shapes.
	const requests: Record<
		Mutation["entity"],
		Record<Mutation["op"], () => Promise<{ data: unknown }>>
	> = {
		keyword: {
			create: () =>
				postKeywords(createBody(mutation) as PostKeywordsBodyOne, options),
			update: () =>
				putKeywordsById(
					id,
					updateBody(mutation) as PutKeywordsByIdBodyOne,
					options,
				),
			delete: () => deleteKeywordsById(id, options),
		},
		keywordAlias: {
			create: () =>
				postKeywordAliases(
					createBody(mutation) as PostKeywordAliasesBodyOne,
					options,
				),
			update: () =>
				putKeywordAliasesById(
					id,
					updateBody(mutation) as PutKeywordAliasesByIdBodyOne,
					options,
				),
			delete: () => deleteKeywordAliasesById(id, options),
		},
		keywordVersion: {
			create: () =>
				postKeywordVersions(
					createBody(mutation) as PostKeywordVersionsBodyOne,
					options,
				),
			update: () =>
				putKeywordVersionsById(
					id,
					updateBody(mutation) as PutKeywordVersionsByIdBodyOne,
					options,
				),
			delete: () => deleteKeywordVersionsById(id, options),
		},
		replacement: {
			create: () =>
				postReplacements(
					createBody(mutation) as PostReplacementsBodyOne,
					options,
				),
			update: () =>
				putReplacementsById(
					id,
					updateBody(mutation) as PutReplacementsByIdBodyOne,
					options,
				),
			delete: () => deleteReplacementsById(id, options),
		},
		keywordCategory: {
			create: () =>
				postKeywordCategories(
					createBody(mutation) as PostKeywordCategoriesBodyOne,
					options,
				),
			update: () =>
				putKeywordCategoriesById(
					id,
					updateBody(mutation) as PutKeywordCategoriesByIdBodyOne,
					options,
				),
			delete: () => deleteKeywordCategoriesById(id, options),
		},
		keywordNature: {
			create: () =>
				postKeywordNatures(
					createBody(mutation) as PostKeywordNaturesBodyOne,
					options,
				),
			update: () =>
				putKeywordNaturesById(
					id,
					updateBody(mutation) as PutKeywordNaturesByIdBodyOne,
					options,
				),
			delete: () => deleteKeywordNaturesById(id, options),
		},
		file: {
			create: () => upload(mutation, options, db),
			update: () => upload(mutation, options, db),
			delete: () => Promise.resolve({ data: null }),
		},
	};
	return toResult(requests[mutation.entity][op]);
}
