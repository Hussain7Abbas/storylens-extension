import { customInstance } from "@/api/axios-instance";
import type {
	ChapterContext,
	ChapterContextRecord,
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
	return (
		await customInstance<ChapterContextRecord>({
			url: path(key),
			method: "GET",
		})
	).data;
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
export async function readContinuity(
	input: ChapterKey & { entityKeys: string[] },
): Promise<ContinuityContext> {
	return (
		await customInstance<ContinuityContext>({
			url: `${path(input)}/continuity`,
			method: "GET",
			params: { entities: JSON.stringify(input.entityKeys) },
		})
	).data;
}
