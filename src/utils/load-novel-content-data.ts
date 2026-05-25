import { sendMessage } from "@/entrypoints/background/messaging";
import type { currentNovelMeta } from "@/types";
import type { NovelContentData } from "@/types/content-data";

export async function loadNovelContentData(
	meta: currentNovelMeta,
): Promise<NovelContentData | undefined> {
	return sendMessage("getNovelContentData", meta);
}
