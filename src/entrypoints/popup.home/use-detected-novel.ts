import { useCallback, useEffect, useState } from "react";
import { browser } from "#imports";
import type { currentNovelMeta } from "@/types";
import type { Novel } from "@/types/models";
import { findNovelBySlug } from "@/utils/novel-matching";
import { sendMessage } from "../background/messaging";

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function getDetectedNovel(
	tabId: number,
): Promise<currentNovelMeta | undefined> {
	try {
		const cached = await sendMessage("getCachedTabNovel", tabId);
		if (cached) {
			return cached;
		}
	} catch {
		// Background cache may not be ready yet.
	}

	for (let attempt = 0; attempt < 8; attempt += 1) {
		try {
			const novel = await sendMessage("getCurrentNovel", undefined, { tabId });
			if (novel) {
				return novel;
			}
		} catch {
			// Content script may still be initializing.
		}

		try {
			const cached = await sendMessage("getCachedTabNovel", tabId);
			if (cached) {
				return cached;
			}
		} catch {
			// Background cache may not be ready yet.
		}

		if (attempt < 7) {
			await sleep(300);
		}
	}

	return undefined;
}

export function useDetectedNovel(
	novels: Novel[] | undefined,
	offlineNovels: Novel[] | undefined,
) {
	const [selectedNovel, setSelectedNovel] = useState<
		Partial<Novel> | undefined
	>();
	const [currentTabNovel, setCurrentTabNovel] = useState<
		currentNovelMeta | undefined
	>();

	const applyDetectedNovel = useCallback(
		(detectedNovel: currentNovelMeta) => {
			setCurrentTabNovel(detectedNovel);

			const candidates = novels?.length ? novels : offlineNovels;
			if (!candidates?.length) {
				return;
			}

			const novel = findNovelBySlug(candidates, detectedNovel.novelSlug);
			if (novel) {
				setSelectedNovel(novel);
			}
		},
		[novels, offlineNovels],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: we want to re-run the effect when novels changes
	useEffect(() => {
		const detectNovel = async () => {
			const [tab] = await browser.tabs.query({
				active: true,
				currentWindow: true,
			});
			if (!tab?.id) {
				return;
			}

			const detectedNovel = await getDetectedNovel(tab.id);
			if (detectedNovel) {
				applyDetectedNovel(detectedNovel);
			}
		};

		void detectNovel();
	}, [applyDetectedNovel, novels]);

	useEffect(() => {
		if (!currentTabNovel) {
			return;
		}

		const candidates = novels?.length ? novels : offlineNovels;
		if (!candidates?.length) {
			return;
		}

		const novel = findNovelBySlug(candidates, currentTabNovel.novelSlug);
		if (novel) {
			setSelectedNovel(novel);
		}
	}, [currentTabNovel, novels, offlineNovels]);

	return {
		selectedNovel,
		setSelectedNovel,
		currentTabNovel,
	};
}
