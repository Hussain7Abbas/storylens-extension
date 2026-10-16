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
	"keyword_suggestion",
	"chapter_extraction",
	"character_image",
	"novel_context",
	"selector_detection",
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/** Older installs used the text source for images too. */
export function featureAiSource(
	feature: AiFeature,
	textSource: unknown,
	imageSource: unknown,
	desktop: DesktopSettings,
): AiSource {
	return parseAiSource(
		feature === "character_image" &&
			(imageSource === "cloud" || imageSource === "desktop")
			? imageSource
			: textSource,
		desktop,
	);
}
