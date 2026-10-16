import { isAiConfigured } from "../desktop-client/ai-config";
import type { DesktopSettings } from "../desktop-client/types";

export type AiSource = "cloud" | "desktop";
export const AI_SOURCE_KEY = "storylens-ai-source";
export const AI_IMAGE_SOURCE_KEY = "storylens-ai-image-source";
export function parseAiSource(
	stored: unknown,
	desktop: DesktopSettings,
): AiSource {
	return stored === "cloud" || stored === "desktop"
		? stored
		: isAiConfigured(desktop)
			? "desktop"
			: "cloud";
}
export const AI_FEATURES = [
	"page_summary",
	"chapter_context",
	"keyword_suggestion",
	"chapter_extraction",
	"character_image",
	"chapter_cover",
	"novel_context",
	"selector_detection",
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];
export type AiImageFeature = "character_image" | "chapter_cover";
export const isImageFeature = (feature: AiFeature): feature is AiImageFeature =>
	feature === "character_image" || feature === "chapter_cover";

/** Older installs used the text source for images too. */
export function featureAiSource(
	feature: AiFeature,
	textSource: unknown,
	imageSource: unknown,
	desktop: DesktopSettings,
): AiSource {
	return parseAiSource(
		isImageFeature(feature) &&
			(imageSource === "cloud" || imageSource === "desktop")
			? imageSource
			: textSource,
		desktop,
	);
}
