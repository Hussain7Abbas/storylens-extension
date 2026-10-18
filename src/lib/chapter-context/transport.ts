import { customInstance } from "@/api/axios-instance";
import { loadContextHistory } from "./history";
import type {
	ChapterContext,
	ChapterContextRecord,
	ContextChapter,
	ContextTracking,
	ContinuityContext,
} from "./schema";
export type ChapterKey = { novelId: string; chapterNumber: number };
export type ContextClaim = ChapterKey & {
	contentHash: string;
	language: "en" | "ar";
	onlyIfMissing?: boolean;
	regenerate?: boolean;
};
export type ContextPublish = ContextClaim & {
	token: string;
	context: ChapterContext;
};
const path = (key: ChapterKey) =>
	`/api/user/chapter-context/${encodeURIComponent(key.novelId)}/${key.chapterNumber}`;
export async function readContext(
	key: ChapterKey,
): Promise<ChapterContextRecord> {
	const record = (
		await customInstance<ChapterContextRecord>({
			url: path(key),
			method: "GET",
			params: { format: "compact" },
		})
	).data;
	return {
		...record,
		inactiveEntities: (record.inactiveEntities ?? []).flatMap((entity) => {
			const chapter =
				entity.lastSeenChapter ?? Reflect.get(entity, "lastMentionedChapter");
			return Number.isInteger(chapter) && key.chapterNumber - chapter < 10
				? [
						{
							entityKey: entity.entityKey,
							name: entity.name,
							keywordId: entity.keywordId,
							lastSeenChapter: chapter as number,
						},
					]
				: [];
		}),
	};
}
export async function claimContext(input: ContextClaim) {
	return (
		await customInstance<{ token: string | null; ready: boolean }>({
			url: `${path(input)}/claim`,
			method: "POST",
			data: {
				contentHash: input.contentHash,
				language: input.language,
				onlyIfMissing: input.onlyIfMissing,
				regenerate: input.regenerate,
			},
		})
	).data;
}
export async function publishContext(input: ContextPublish): Promise<void> {
	await customInstance({
		url: path(input),
		method: "PUT",
		data: {
			token: input.token,
			contentHash: input.contentHash,
			language: input.language,
			context: input.context,
		},
	});
}
export async function releaseContext(
	input: ChapterKey & { token: string },
): Promise<void> {
	await customInstance({
		url: `${path(input)}/claim`,
		method: "DELETE",
		data: { token: input.token },
	});
}
export async function readTracking(
	input: ChapterKey & { entityKeys: string[] },
): Promise<ContextTracking> {
	return (
		await customInstance<ContextTracking>({
			url: `${path(input)}/tracking`,
			method: "POST",
			data: { entityKeys: input.entityKeys },
		})
	).data;
}
export async function readBulkContexts(
	input: ChapterKey & { chapterNumbers: number[]; entityKeys: string[] },
): Promise<ContextChapter[]> {
	return (
		await customInstance<{ chapters: ContextChapter[] }>({
			url: `${path(input)}/bulk`,
			method: "POST",
			data: {
				chapterNumbers: input.chapterNumbers,
				entityKeys: input.entityKeys,
			},
		})
	).data.chapters;
}
export async function readContinuity(
	input: ChapterKey & { entityKeys: string[]; text?: string },
): Promise<ContinuityContext> {
	return loadContextHistory(input, {
		tracking: readTracking,
		bulk: readBulkContexts,
	});
}
