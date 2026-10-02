import { Alert, Button, Text, Tooltip } from "@mantine/core";
import { ImagePlus as IconImagePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { browser } from "#imports";
import { AiPrice } from "@/components/lens/ai-price";
import { GetLensesLink } from "@/components/lens/get-lenses-link";
import { useLensLabel } from "@/components/lens/lens-price";
import { sendMessage } from "@/entrypoints/background/messaging";
import { availabilityKey } from "@/lib/ai-source/availability";
import { useAiAvailability, useAiSnapshot } from "@/lib/ai-source/hooks";
import { aiState } from "@/lib/ai-source/storage";
import { trackEvent } from "@/lib/analytics/client";
import { unwrapAiReply } from "@/lib/cloud-ai/errors";
import { aiErrorMessage, handleUnavailableAi } from "@/lib/cloud-ai/top-up";
import { toAiLanguage } from "@/lib/desktop-client/ai-language";
import {
	buildCharacterImagePrompt,
	chapterMentions,
} from "@/lib/desktop-client/character-image";
import {
	ensureNovelContext,
	loadNovel,
} from "@/lib/desktop-client/novel-context";
import { aiPrompts } from "@/lib/desktop-client/settings";
import { useAiTask } from "@/lib/launcher-frame/use-ai-task";
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
 * Generates a character image with the selected AI source from the
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
	const availability = useAiAvailability("character_image");
	const { source, pricing } = useAiSnapshot();
	const label = useLensLabel();
	const [needsContext, setNeedsContext] = useState(false);
	useEffect(() => {
		let active = true;
		void loadNovel(novelId, i18n.language.startsWith("ar") ? "ar" : "en")
			.then((novel) => {
				if (active) setNeedsContext(!!novel && !novel.context?.trim());
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, [novelId, i18n.language]);
	const imagePrice =
		source === "cloud"
			? (pricing?.features.find((row) => row.key === "character_image")
					?.lenses ?? 0)
			: 0;
	const researchPrice =
		source === "cloud" && needsContext
			? (pricing?.features.find(
					(row) => row.key === "novel_context" && row.enabled,
				)?.lenses ?? 0)
			: 0;
	const aiConfigured = availability.ok;
	const [revisedPrompt, setRevisedPrompt] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const controller = useRef<AbortController | null>(null);
	const requestId = useRef<string | null>(null);
	// The launcher keeps the popup and shows progress while the image is drawn.
	useLauncherWork({ working: busy, failed: !!error });
	useAiTask({
		operation: "generate-image",
		subject: name,
		working: busy,
		failed: !!error,
	});

	useEffect(
		() => () => {
			controller.current?.abort();
			if (requestId.current)
				void sendMessage("cancelAiPrompt", requestId.current).catch(() => {});
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
		setRevisedPrompt(undefined);
		setBusyState(true);
		try {
			const ai = await aiState("character_image");
			const settings = ai.desktop;
			if (!ai.availability.ok)
				throw new Error(t(availabilityKey(ai.availability)));
			const language = toAiLanguage(i18n.language);
			const [prompts, chapterText, novelContext] = await Promise.all([
				aiPrompts(),
				activeChapterText(),
				ensureNovelContext({
					novelId,
					language,
					settings,
					source: ai.source,
					parentFeature: "character_image",
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
				provider: ai.source,
				...(ai.source === "desktop" ? { effort: settings.effort } : {}),
				has_novel_context: !!novelContext,
			});
			const id = crypto.randomUUID();
			requestId.current = id;
			const image = unwrapAiReply(
				await sendMessage("generateAiImage", {
					source: ai.source,
					actionId: crypto.randomUUID(),
					requestId: id,
					prompt,
					model: settings.model,
					effort: settings.effort,
				}),
			);
			requestId.current = null;
			if (abort.signal.aborted) return;
			setRevisedPrompt(image.revisedPrompt);
			onGenerated(base64File(image.data, image.mimeType, name));
		} catch (cause) {
			requestId.current = null;
			if (abort.signal.aborted) return;
			setError(await aiErrorMessage(cause, "character_image", t));
		} finally {
			if (!abort.signal.aborted) setBusyState(false);
		}
	};

	return (
		<>
			<Tooltip
				label={
					aiConfigured
						? `${t("coloring.generateImageHint")}${imagePrice > 0 ? ` · ${label(imagePrice)}` : ""}${researchPrice > 0 ? ` · ${t("cloud.researchCost", { lenses: label(researchPrice) })}` : ""}`
						: t(availabilityKey(availability))
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
						if (!aiConfigured) {
							event.preventDefault();
							handleUnavailableAi(availability);
						} else void generate();
					}}
					style={{ alignSelf: "flex-start" }}
				>
					{t("coloring.generateImage")} <AiPrice feature="character_image" />
				</Button>
			</Tooltip>
			{busy && (
				<Text size="xs" c="dimmed" role="status">
					{t("coloring.generatingImage")}
				</Text>
			)}
			{revisedPrompt && (
				<details>
					<summary>{t("cloud.whatDrawn")}</summary>
					<Text size="xs">{revisedPrompt}</Text>
				</details>
			)}
			{error && (
				<Alert color="red" py="xs">
					{t("coloring.imageGenerateFailed")}: {error} <GetLensesLink />
				</Alert>
			)}
		</>
	);
}
