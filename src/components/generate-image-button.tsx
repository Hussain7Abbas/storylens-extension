import { Alert, Button, Group, Text, Tooltip } from "@mantine/core";
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
import { aiErrorMessage } from "@/lib/cloud-ai/top-up";
import { toAiLanguage } from "@/lib/desktop-client/ai-language";
import { DEFAULT_AI_PROMPTS } from "@/lib/desktop-client/ai-prompts";
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
import { CopyImagePrompt } from "./copy-image-prompt";
import { StopImageButton } from "./stop-image-button";

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
	initialPrompt,
	initialStopped = false,
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
	initialPrompt?: string;
	initialStopped?: boolean;
}) {
	const { t, i18n } = useTranslation();
	const availability = useAiAvailability("character_image");
	const {
		source: textSource,
		imageSource: source,
		pricing,
		loaded,
	} = useAiSnapshot();
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
		textSource === "cloud" && needsContext
			? (pricing?.features.find(
					(row) => row.key === "novel_context" && row.enabled,
				)?.lenses ?? 0)
			: 0;
	const aiConfigured = availability.ok;
	const [revisedPrompt, setRevisedPrompt] = useState<string | undefined>(
		initialRevisedPrompt,
	);
	const promptInputs = JSON.stringify([
		novelId,
		name,
		otherNames,
		description,
		category,
		i18n.language,
	]);
	const [preparedPrompt, setPreparedPrompt] = useState(
		initialPrompt ? { value: initialPrompt, inputs: promptInputs } : undefined,
	);
	const [busy, setBusy] = useState(false);
	const prompt =
		busy || preparedPrompt?.inputs === promptInputs
			? preparedPrompt?.value
			: undefined;
	const setPrompt = (value: string) =>
		setPreparedPrompt({ value, inputs: promptInputs });
	const [stopped, setStopped] = useState(initialStopped);
	const [error, setError] = useState<string | null>(initialError ?? null);
	const controller = useRef<AbortController | null>(null);
	// The launcher keeps the popup and shows progress while the image is drawn.
	useLauncherWork({ working: busy, failed: !!error });
	useAiTask({
		operation: "generate-image",
		subject: name,
		working: busy,
		failed: !!error,
		holding: !stopped,
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

	const build = (
		instructions: string,
		chapterText: string,
		novelContext: string,
	) =>
		buildCharacterImagePrompt({
			name,
			otherNames,
			description,
			category,
			instructions,
			chapterExcerpts: chapterMentions(chapterText, [name, ...otherNames]),
			novelContext,
		});

	const preparePrompt = async () => {
		const [prompts, chapterText, novel] = await Promise.all([
			aiPrompts().catch(() => DEFAULT_AI_PROMPTS),
			activeChapterText(),
			loadNovel(novelId, toAiLanguage(i18n.language)).catch(() => undefined),
		]);
		return build(prompts.imagePrompt, chapterText, novel?.context ?? "");
	};

	const generate = async () => {
		if (!name.trim()) {
			setError(t("coloring.imageNeedsName"));
			return;
		}
		controller.current?.abort();
		const abort = new AbortController();
		controller.current = abort;
		setError(null);
		setStopped(false);
		setRevisedPrompt(undefined);
		setBusyState(true);
		// A usable prompt remains available even when pairing, billing or generation fails.
		setPrompt(build(DEFAULT_AI_PROMPTS.imagePrompt, "", ""));
		try {
			const language = toAiLanguage(i18n.language);
			const [ai, textAi, prompts, chapterText, novel] = await Promise.all([
				aiState("character_image"),
				aiState("novel_context"),
				aiPrompts(),
				activeChapterText(),
				loadNovel(novelId, language),
			]);
			if (abort.signal.aborted) return;
			let prompt = build(
				prompts.imagePrompt,
				chapterText,
				novel?.context ?? "",
			);
			setPrompt(prompt);
			if (!ai.availability.ok)
				throw new Error(t(availabilityKey(ai.availability)));
			const settings = ai.desktop;
			const novelContext = await ensureNovelContext({
				novelId,
				language,
				settings: textAi.desktop,
				source: textAi.source,
				parentFeature: ai.source === "cloud" ? "character_image" : undefined,
				signal: abort.signal,
			});
			if (abort.signal.aborted) return;
			prompt = build(prompts.imagePrompt, chapterText, novelContext);
			setPrompt(prompt);
			trackEvent("ai_image_generation_requested", {
				provider: ai.source,
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
			const message = await aiErrorMessage(cause, "character_image", t);
			if (!abort.signal.aborted) setError(message);
		} finally {
			if (controller.current === abort) {
				controller.current = null;
				setBusyState(false);
			}
		}
	};

	// A form opened to draw an image starts once, after its values loaded.
	const started = useRef(initialStopped);
	const latestGenerate = useRef(generate);
	latestGenerate.current = generate;
	useEffect(() => {
		if (started.current || !autoStart || !loaded || !name.trim()) return;
		// Preparing an unavailable source still exposes the prompt; start once it becomes ready.
		if (aiConfigured) started.current = true;
		void latestGenerate.current();
	}, [autoStart, loaded, aiConfigured, name]);

	const stop = () => {
		const active = controller.current;
		if (!active) return;
		// A stopped auto-start request stays stopped even if settings change.
		started.current = true;
		controller.current = null;
		active.abort();
		setBusyState(false);
		setStopped(true);
		setError(null);
		trackEvent("ai_image_generation_stopped");
	};
	return (
		<>
			<Group gap="xs" align="flex-start">
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
						onClick={() => {
							void generate();
						}}
						style={{ alignSelf: "flex-start" }}
					>
						{t("coloring.generateImage")} <AiPrice feature="character_image" />
					</Button>
				</Tooltip>
				<CopyImagePrompt
					prompt={prompt ?? preparePrompt}
					promptKey={prompt ?? promptInputs}
					disabled={!prompt && !name.trim()}
				/>
			</Group>
			{busy && <StopImageButton onStop={stop} />}
			{stopped && (
				<Text size="xs" c="dimmed" role="status">
					{t("coloring.imageStopped")}
				</Text>
			)}
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
