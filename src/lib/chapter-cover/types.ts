export const AUTO_CHAPTER_COVER_KEY = "storylens-auto-chapter-cover";
export type ChapterCover = {
	image: { id: string; url: string } | null;
	generating: boolean;
};
export type CoverKey = { novelId: string; chapterNumber: number };
export type CoverRequest = CoverKey &
	(
		| { action: "read" }
		| { action: "claim" }
		| { action: "release"; token: string }
		| {
				action: "publish";
				token: string;
				imageId: string;
				data: string;
				mimeType: string;
		  }
	);
export type CoverReply = ChapterCover & { token?: string | null };
