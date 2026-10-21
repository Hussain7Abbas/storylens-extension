export const AUTO_CHAPTER_COVER_KEY = "storylens-auto-chapter-cover";
export type ChapterCover = {
	image: { id: string; url: string } | null;
	generating: boolean;
	imagePrompt?: string | null;
	promptUpdatedAt?: string | null;
	canEditPrompt?: boolean;
	canRestart?: boolean;
};
export type CoverKey = { novelId: string; chapterNumber: number };
export type CoverRequest = CoverKey &
	(
		| { action: "read" }
		| { action: "claim"; regenerate?: boolean; restartIfUpdatedAt?: string }
		| { action: "release"; token: string }
		| { action: "savePrompt"; imagePrompt: string; baseUpdatedAt: string }
		| {
				action: "publish";
				token: string;
				imageId: string;
				data: string;
				mimeType: string;
				imagePrompt?: string;
		  }
	);
export type CoverReply = ChapterCover & { token?: string | null };
