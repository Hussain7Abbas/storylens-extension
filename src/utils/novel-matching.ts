export function normalizeSlug(slug: string): string {
	return slug.trim().toLowerCase();
}

export type NovelWithSlugs = {
	slugs: string[];
};

export function findNovelBySlug<T extends NovelWithSlugs>(
	novels: T[],
	slug: string,
): T | undefined {
	const normalized = normalizeSlug(slug);
	return novels.find((novel) =>
		novel.slugs.some((entry) => normalizeSlug(entry) === normalized),
	);
}
