export const AUTO_CHAPTER_COVER_KEY = "storylens-auto-chapter-cover";
export type ChapterCover = {
	image: { id: string; url: string } | null;
	generating: boolean;
	imageDescription?: string | null;
	promptUpdatedAt?: string | null;
	canEditPrompt?: boolean;
	canRestart?: boolean;
};
export type CoverKey = { novelId: string; chapterNumber: number };

export function assertImageChapter(
	expected: CoverKey | undefined,
	received: unknown,
) {
	if (
		!expected ||
		!received ||
		typeof received !== "object" ||
		!("novelId" in received) ||
		!("chapterNumber" in received) ||
		received.novelId !== expected.novelId ||
		received.chapterNumber !== expected.chapterNumber
	)
		throw new Error(
			"Image generation returned a result for a different chapter.",
		);
}
export type CoverRequest = CoverKey &
	(
		| { action: "read" }
		| { action: "claim"; regenerate?: boolean; restartIfUpdatedAt?: string }
		| { action: "release"; token: string }
		| { action: "savePrompt"; imageDescription: string; baseUpdatedAt: string }
		| {
				action: "publish";
				token: string;
				imageId: string;
				data: string;
				mimeType: string;
				imageDescription?: string;
		  }
	);
export type CoverReply = ChapterCover & { token?: string | null };
