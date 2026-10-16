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
import { aiErrorMessage, handleUnavailableAi } from "@/lib/cloud-ai/top-up";
import { toAiLanguage } from "@/lib/desktop-client/ai-language";
import {
	buildCharacterImagePrompt,
	chapterMentions,
} from "@/lib/desktop-client/character-image";
import { generateCharacterImage } from "@/lib/desktop-client/character-image-job";
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
	autoStart = false,
	initialError,
	initialRevisedPrompt,
}: {
	novelId: string;
	name: string;
	otherNames?: string[];
	description: string;
	category?: string;
	onGenerated: (file: File) => void;
	onBusyChange?: (busy: boolean) => void;
	/**
	 * Draws one image as soon as the form has a name and the source is ready,
	 * for a form opened from the page's **Generate image with AI** action.
	 */
	autoStart?: boolean;
	initialError?: string;
	initialRevisedPrompt?: string;
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
	const [revisedPrompt, setRevisedPrompt] = useState<string | undefined>(
		initialRevisedPrompt,
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(initialError ?? null);
	const controller = useRef<AbortController | null>(null);
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
			const image = await generateCharacterImage({
				source: ai.source,
				settings,
				prompt,
				name,
				signal: abort.signal,
			});
			if (abort.signal.aborted) return;
			setRevisedPrompt(image.revisedPrompt);
			onGenerated(image.file);
		} catch (cause) {
			if (abort.signal.aborted) return;
			setError(await aiErrorMessage(cause, "character_image", t));
		} finally {
			if (!abort.signal.aborted) setBusyState(false);
		}
	};

	// A form opened to draw an image starts once, after its values loaded.
	const started = useRef(false);
	const latestGenerate = useRef(generate);
	latestGenerate.current = generate;
	useEffect(() => {
		if (started.current || !autoStart || !aiConfigured || !name.trim()) return;
		started.current = true;
		void latestGenerate.current();
	}, [autoStart, aiConfigured, name]);

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
