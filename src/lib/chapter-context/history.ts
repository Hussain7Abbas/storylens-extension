import { lettersPattern } from "@/utils/arabic";
import type {
	ContextChapter,
	ContextTracking,
	ContinuityContext,
} from "./schema";
import type { ChapterKey } from "./transport";
export type HistoryInput = ChapterKey & { entityKeys: string[]; text?: string };
function mentioned(text: string, name: string) {
	if (!name.trim()) return false;
	return new RegExp(
		`(?<![\\p{L}\\p{M}\\p{N}_])${lettersPattern(name).replace(/[اأإآٱ]/gu, "[اأإآٱ]")}(?![\\p{L}\\p{M}\\p{N}_])`,
		"iu",
	).test(text);
}
/** Only one earlier chapter for normal tracking. Recover older returning elements in one bulk read. */
export async function loadContextHistory(
	input: HistoryInput,
	read: {
		tracking: (
			input: ChapterKey & { entityKeys: string[] },
		) => Promise<ContextTracking>;
		bulk: (
			input: ChapterKey & { chapterNumbers: number[]; entityKeys: string[] },
		) => Promise<ContextChapter[]>;
	},
): Promise<ContinuityContext> {
	const tracking = await read.tracking(input);
	const previous =
		tracking.previous && tracking.previous.chapterNumber < input.chapterNumber
			? tracking.previous
			: null;
	const keys = new Set(input.entityKeys);
	const returning = [...tracking.lastSeen]
		.sort((a, b) => b.lastSeenChapter - a.lastSeenChapter)
		.filter(
			(entity) =>
				entity.lastSeenChapter < input.chapterNumber &&
				(keys.has(entity.entityKey) ||
					(!!input.text && mentioned(input.text, entity.name))),
		)
		.filter(
			(entity, index, all) =>
				all.findIndex((row) => row.entityKey === entity.entityKey) === index,
		)
		.slice(0, 80);
	// A predecessor older than ten chapters is used only for elements explicitly returning now.
	const activeKeys = new Set(returning.map((entity) => entity.entityKey));
	const trim = (chapter: ContextChapter): ContextChapter => ({
		...chapter,
		context: {
			...chapter.context,
			scenes: chapter.context.scenes.map((scene) => ({
				...scene,
				entities: scene.entities.filter(
					(entity) =>
						input.chapterNumber - chapter.chapterNumber < 10 ||
						activeKeys.has(entity.entityKey),
				),
			})),
			stateChanges: chapter.context.stateChanges.filter(
				(change) =>
					input.chapterNumber - chapter.chapterNumber < 10 ||
					activeKeys.has(change.entityKey),
			),
		},
	});
	const numbers = [
		...new Set(
			returning
				.filter((entity) => entity.lastSeenChapter !== previous?.chapterNumber)
				.map((entity) => entity.lastSeenChapter),
		),
	];
	const older = numbers.length
		? await read.bulk({
				...input,
				chapterNumbers: numbers,
				entityKeys: returning.map((entity) => entity.entityKey),
			})
		: [];
	const result: ContinuityContext = {
		chapters: previous ? [trim(previous)] : [],
		lastMentions: [],
		persistentState: [],
	};
	for (const entity of returning) {
		const chapter = older.find(
			(chapter) =>
				chapter.chapterNumber === entity.lastSeenChapter &&
				chapter.chapterNumber < input.chapterNumber,
		);
		if (!chapter) continue;
		const context = {
			...chapter.context,
			summary: "",
			scenes: chapter.context.scenes
				.map((scene) => ({
					...scene,
					entities: scene.entities.filter(
						(item) => item.entityKey === entity.entityKey,
					),
				}))
				.filter((scene) => scene.entities.length),
			stateChanges: chapter.context.stateChanges.filter(
				(change) => change.entityKey === entity.entityKey,
			),
		};
		if (!context.scenes.length) continue;
		result.lastMentions.push({
			entityKey: entity.entityKey,
			name: entity.name,
			chapterNumber: chapter.chapterNumber,
			context,
		});
	}
	return result;
}
