import {
	type ChapterContext,
	type ChapterContextRecord,
	chapterContextSchema,
} from "../chapter-context/schema";

export const COVER_CONTEXT_POLL_MS = 1500;

export function waitForContextPoll(signal: AbortSignal): Promise<void> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const cancel = () => {
			clearTimeout(timer);
			reject(signal.reason);
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", cancel);
			resolve();
		}, COVER_CONTEXT_POLL_MS);
		signal.addEventListener("abort", cancel, { once: true });
		if (signal.aborted) cancel();
	});
}

/** Wait for this chapter's published snapshot, including completion of a replacement in progress. */
export async function waitForChapterCoverContext(input: {
	read: () => Promise<ChapterContextRecord | undefined>;
	signal: AbortSignal;
	onWaiting: (generating: boolean) => void;
	poll?: (signal: AbortSignal) => Promise<void>;
}): Promise<ChapterContext> {
	while (true) {
		input.signal.throwIfAborted();
		const record = await input.read();
		input.signal.throwIfAborted();
		const parsed = chapterContextSchema.safeParse(record?.context);
		if (!record?.generating && parsed.success) return parsed.data;
		input.onWaiting(record?.generating === true);
		await (input.poll ?? waitForContextPoll)(input.signal);
	}
}

/** Keep all scene overviews and whole visual records; never slice serialized JSON. */
export function coverContextJson(
	context: ChapterContext,
	maxChars = 60_000,
): string {
	const full = JSON.stringify(context);
	if (full.length <= maxChars) return full;
	const compact = (limit: number) => ({
		schemaVersion: context.schemaVersion,
		summary: context.summary.slice(0, limit * 5),
		scenes: context.scenes.map((scene) => ({
			id: scene.id,
			title: scene.title.slice(0, limit),
			environment: Object.fromEntries(
				Object.entries(scene.environment).map(([key, value]) => [
					key,
					value.slice(0, limit),
				]),
			),
			entities: [] as ChapterContext["scenes"][number]["entities"],
		})),
		stateChanges: [] as ChapterContext["stateChanges"],
		abbreviated: true,
	});
	let payload = compact(200);
	for (const limit of [100, 50, 25]) {
		if (JSON.stringify(payload).length <= maxChars) break;
		payload = compact(limit);
	}
	if (JSON.stringify(payload).length > maxChars)
		throw new Error("Chapter context cannot fit in the cover prompt limit.");
	const fits = () => JSON.stringify(payload).length <= maxChars;
	// Distribute detailed observations across scenes instead of filling the budget with only the opening scene.
	const count = Math.max(
		0,
		...context.scenes.map((scene) => scene.entities.length),
	);
	for (let index = 0; index < count; index++) {
		context.scenes.forEach((scene, sceneIndex) => {
			const entity = scene.entities[index];
			const target = payload.scenes[sceneIndex];
			if (!entity || !target) return;
			target.entities.push(entity);
			if (!fits()) target.entities.pop();
		});
	}
	for (const change of context.stateChanges) {
		if (
			!payload.scenes
				.find((scene) => scene.id === change.sceneId)
				?.entities.some((entity) => entity.entityKey === change.entityKey)
		)
			continue;
		payload.stateChanges.push(change);
		if (!fits()) payload.stateChanges.pop();
	}
	return JSON.stringify(payload);
}
