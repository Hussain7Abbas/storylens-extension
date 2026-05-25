export function normalizeSlug(slug: string): string {
	return slug.trim().toLowerCase();
}

export type NovelWithSlugs = {
	slugs: string[];
};

export function isSlugInList(slug: string, slugs: string[]): boolean {
	const normalized = normalizeSlug(slug);
	return slugs.some((entry) => normalizeSlug(entry) === normalized);
}

export function findNovelBySlug<T extends NovelWithSlugs>(
	novels: T[],
	slug: string,
): T | undefined {
	return novels.find((novel) => isSlugInList(slug, novel.slugs));
}
