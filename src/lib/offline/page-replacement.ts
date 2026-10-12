import { z } from "zod";
import { browser } from "#imports";
import { getStoredAuth } from "@/lib/auth/auth-storage";
import {
	isOfflineUnavailable,
	offlineDb,
	type StoryLensDatabase,
} from "@/lib/offline/db";
import {
	enqueue,
	NotSignedIn,
	PermissionDenied,
	StorageUnavailable,
	ValidationFailed,
} from "@/lib/offline/outbox";
import { getTabNovel } from "@/lib/offline/sync/tabs";
import { getNovelView } from "@/lib/offline/views";
import { getStoredLanguage } from "@/utils/stored-language";
import { nameIn } from "@/utils/translation";

const inputSchema = z.object({
	novelId: z.string().uuid(),
	keywordId: z.string().uuid(),
	from: z.string().trim().min(1).max(512),
});
export type PageReplacementInput = z.infer<typeof inputSchema>;
export type PageReplacementReply =
	| { ok: true; refreshed: boolean }
	| { error: string };

/** A page pick writes only through the extension outbox and derives To from the real keyword. */
export async function queuePageReplacement(
	input: unknown,
	sender: {
		id?: string;
		tab?: { id?: number };
		frameId?: number;
		url?: string;
	},
	db: StoryLensDatabase = offlineDb(),
): Promise<{ ok: true; novelSlug: string } | { error: string }> {
	if (isOfflineUnavailable()) return { error: "offline.storageUnavailable" };
	const parsed = inputSchema.safeParse(input);
	if (
		!parsed.success ||
		sender.id !== browser.runtime.id ||
		sender.tab?.id === undefined ||
		sender.frameId !== 0 ||
		!/^https?:\/\//.test(sender.url ?? "")
	)
		return { error: "offline.errors.invalid" };
	const tab = await getTabNovel(sender.tab.id);
	if (!tab || tab.novelId !== parsed.data.novelId)
		return { error: "offline.errors.invalid" };
	try {
		const { user } = await getStoredAuth();
		if (!user || user.isGuest) throw new NotSignedIn();
		const view = await getNovelView(parsed.data.novelId, user.id, db);
		const keyword = view.keywords.find(
			(item) => item.id === parsed.data.keywordId,
		);
		const to = keyword ? nameIn(keyword, await getStoredLanguage()).trim() : "";
		if (!to || to === parsed.data.from)
			return { error: "offline.errors.invalid" };
		await enqueue(
			{
				entity: "replacement",
				op: "create",
				novelId: parsed.data.novelId,
				values: { from: parsed.data.from, to, matchingType: "FULL" },
			},
			{ db, user },
		);
		return { ok: true, novelSlug: tab.novelSlug };
	} catch (error) {
		if (error instanceof NotSignedIn)
			return { error: "offline.errors.notSignedIn" };
		if (error instanceof PermissionDenied)
			return { error: "offline.errors.permission" };
		if (error instanceof StorageUnavailable)
			return { error: "offline.storageUnavailable" };
		if (error instanceof ValidationFailed)
			return { error: `offline.errors.${error.code}` };
		return { error: "offline.errors.invalid" };
	}
}
