import { Alert, Button, Text, Tooltip } from "@mantine/core";
import { ImagePlus as IconImagePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { browser } from "#imports";
import { sendMessage } from "@/entrypoints/background/messaging";
import { trackEvent } from "@/lib/analytics/client";
import { toAiLanguage } from "@/lib/desktop-client/ai-language";
import {
	buildCharacterImagePrompt,
	chapterMentions,
} from "@/lib/desktop-client/character-image";
import { ensureNovelContext } from "@/lib/desktop-client/novel-context";
import { aiPrompts, desktopSettings } from "@/lib/desktop-client/settings";
import { useAiConfigured } from "@/lib/desktop-client/use-ai-configured";
import { useLauncherWork } from "@/lib/launcher-frame/use-launcher-work";

/** Reads the chapter shown in the active tab; empty when no novel page is open. */
async function activeChapterText(): Promise<string> {
	try {
		const [tab] = await browser.tabs.query({
			active: true,
			currentWindow: true,
		});
		if (tab?.id === undefined) return "";
		const { text } = await sendMessage("getChapterText", undefined, {
			tabId: tab.id,
		});
		return text;
	} catch {
		return "";
	}
}

function base64File(data: string, mimeType: string, name: string): File {
	const binary = atob(data);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++)
		bytes[index] = binary.charCodeAt(index);
	const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
	const base =
		name
			.trim()
			.replace(/[^\p{L}\p{N}]+/gu, "-")
			.replace(/^-|-$/g, "") || "character";
	return new File([bytes], `${base}.${extension}`, { type: mimeType });
}

/**
 * Generates a character image with the desktop client (Codex) from the
 * chapter mentions, the entity details and the novel context. The image is
 * handed to the form as a file, which uploads it to image storage on save.
 */
export function GenerateImageButton({
	novelId,
	name,
	otherNames = [],
	description,
	category,
	onGenerated,
	onBusyChange,
}: {
	novelId: string;
	name: string;
	otherNames?: string[];
	description: string;
	category?: string;
	onGenerated: (file: File) => void;
	onBusyChange?: (busy: boolean) => void;
}) {
	const { t, i18n } = useTranslation();
	const aiConfigured = useAiConfigured();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const controller = useRef<AbortController | null>(null);
	const requestId = useRef<string | null>(null);
	// The launcher keeps the popup and shows progress while the image is drawn.
	useLauncherWork({ working: busy, failed: !!error });

	useEffect(
		() => () => {
			controller.current?.abort();
			if (requestId.current)
				void sendMessage("cancelDesktopPrompt", requestId.current).catch(
					() => {},
				);
		},
		[],
	);

	const setBusyState = (value: boolean) => {
		setBusy(value);
		onBusyChange?.(value);
	};

	const generate = async () => {
		if (!name.trim()) {
			setError(t("coloring.imageNeedsName"));
			return;
		}
		const abort = new AbortController();
		controller.current = abort;
		setError(null);
		setBusyState(true);
		try {
			const settings = await desktopSettings();
			if (!settings.token || !settings.model || !settings.effort)
				throw new Error(t("desktop.selectModel"));
			const language = toAiLanguage(i18n.language);
			const [prompts, chapterText, novelContext] = await Promise.all([
				aiPrompts(),
				activeChapterText(),
				ensureNovelContext({
					novelId,
					language,
					settings,
					signal: abort.signal,
				}),
			]);
			if (abort.signal.aborted) return;
			const prompt = buildCharacterImagePrompt({
				name,
				otherNames,
				description,
				category,
				instructions: prompts.imagePrompt,
				chapterExcerpts: chapterMentions(chapterText, [name, ...otherNames]),
				novelContext,
			});
			trackEvent("ai_image_generation_requested", {
				effort: settings.effort,
				has_novel_context: !!novelContext,
			});
			const id = crypto.randomUUID();
			requestId.current = id;
			const image = await sendMessage("generateDesktopImage", {
				requestId: id,
				prompt,
				model: settings.model,
				effort: settings.effort,
			});
			requestId.current = null;
			if (abort.signal.aborted) return;
			onGenerated(base64File(image.data, image.mimeType, name));
		} catch (cause) {
			requestId.current = null;
			if (abort.signal.aborted) return;
			setError(
				cause instanceof Error
					? cause.message
					: t("coloring.imageGenerateFailed"),
			);
		} finally {
			if (!abort.signal.aborted) setBusyState(false);
		}
	};

	return (
		<>
			<Tooltip
				label={
					aiConfigured
						? t("coloring.generateImageHint")
						: t("desktop.configureAi")
				}
				withArrow
				openDelay={350}
				multiline
				maw={260}
			>
				<Button
					type="button"
					size="xs"
					variant="light"
					leftSection={<IconImagePlus size={14} strokeWidth={1.75} />}
					loading={busy}
					data-disabled={!aiConfigured || undefined}
					onClick={(event) => {
						if (!aiConfigured) event.preventDefault();
						else void generate();
					}}
					style={{ alignSelf: "flex-start" }}
				>
					{t("coloring.generateImage")}
				</Button>
			</Tooltip>
			{busy && (
				<Text size="xs" c="dimmed" role="status">
					{t("coloring.generatingImage")}
				</Text>
			)}
			{error && (
				<Alert color="red" py="xs">
					{t("coloring.imageGenerateFailed")}: {error}
				</Alert>
			)}
		</>
	);
}
