import { Alert, Button, Group, Text, Tooltip } from "@mantine/core";
import { ImagePlus as IconImagePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { browser } from "#imports";
import { AiPrice } from "@/components/lens/ai-price";
import { GetLensesLink } from "@/components/lens/get-lenses-link";
import { LensPrice, useLensLabel } from "@/components/lens/lens-price";
import { sendMessage } from "@/entrypoints/background/messaging";
import { availabilityKey } from "@/lib/ai-source/availability";
import { useAiAvailability, useAiSnapshot } from "@/lib/ai-source/hooks";
import { aiState } from "@/lib/ai-source/storage";
import { trackEvent } from "@/lib/analytics/client";
import { withImageContinuity } from "@/lib/chapter-context/image";
import { aiErrorMessage } from "@/lib/cloud-ai/top-up";
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
import { CopyImagePrompt } from "./copy-image-prompt";
import { MultiButtonsModal } from "./multi-buttons-modal";
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
	imagePrompt,
	onPromptChange,
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
	imagePrompt: string;
	onPromptChange: (prompt: string) => void;
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
	const [contextLoaded, setContextLoaded] = useState(false);
	useEffect(() => {
		let active = true;
		setContextLoaded(false);
		void loadNovel(novelId, i18n.language.startsWith("ar") ? "ar" : "en")
			.then((novel) => {
				if (active) setNeedsContext(!!novel && !novel.context?.trim());
			})
			.catch(() => {})
			.finally(() => {
				if (active) setContextLoaded(true);
			});
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
		textSource === "cloud" && needsContext && !imagePrompt.trim()
			? (pricing?.features.find(
					(row) => row.key === "novel_context" && row.enabled,
				)?.lenses ?? 0)
			: 0;
	const aiConfigured = availability.ok;
	const [revisedPrompt, setRevisedPrompt] = useState<string | undefined>(
		initialRevisedPrompt,
	);
	const [busy, setBusy] = useState(false);
	const [copying, setCopying] = useState(false);
	const [needsPrompt, setNeedsPrompt] = useState(false);
	const [focusRequest, setFocusRequest] = useState(0);
	const generateButton = useRef<HTMLButtonElement>(null);
	const prompt = imagePrompt;
	const hasPrompt = !!prompt.trim();
	const setPrompt = onPromptChange;
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

	useEffect(() => {
		onBusyChange?.(busy || copying);
	}, [busy, copying, onBusyChange]);
	const setBusyState = setBusy;

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
		// A saved or edited prompt is the exact source for every subsequent image.
		const existingPrompt = prompt.trim() ? prompt : undefined;
		try {
			const ai = await aiState("character_image");
			if (abort.signal.aborted) return;
			if (!ai.availability.ok)
				throw new Error(t(availabilityKey(ai.availability)));
			let submittedPrompt = existingPrompt;
			let hasNovelContext: boolean | undefined;
			if (!submittedPrompt) {
				const language = toAiLanguage(i18n.language);
				const [textAi, prompts, chapterText] = await Promise.all([
					aiState("novel_context"),
					aiPrompts(),
					activeChapterText(),
				]);
				if (!chapterText.trim()) throw new Error(t("coloring.imageNoChapter"));
				const novelContext = await ensureNovelContext({
					novelId,
					language,
					settings: textAi.desktop,
					source: textAi.source,
					parentFeature: ai.source === "cloud" ? "character_image" : undefined,
					signal: abort.signal,
				});
				if (abort.signal.aborted) return;
				hasNovelContext = !!novelContext;
				submittedPrompt = await withImageContinuity({
					novelId,
					names: [name, ...otherNames],
					prompt: build(prompts.imagePrompt, chapterText, novelContext),
				});
				if (abort.signal.aborted) return;
			}
			trackEvent("ai_image_generation_requested", {
				provider: ai.source,
				...(hasNovelContext === undefined
					? {}
					: { has_novel_context: hasNovelContext }),
			});
			const image = await generateCharacterImage({
				source: ai.source,
				settings: ai.desktop,
				prompt: submittedPrompt,
				promptIsDescription: !!existingPrompt,
				name,
				signal: abort.signal,
			});
			if (abort.signal.aborted) return;
			setRevisedPrompt(image.revisedPrompt);
			setPrompt(image.prompt ?? existingPrompt ?? "");
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

	const requestGenerate = () => {
		if (!name.trim()) {
			setError(t("coloring.imageNeedsName"));
			return;
		}
		if (!prompt.trim()) {
			setNeedsPrompt(true);
			return;
		}
		void generate();
	};

	// A form opened to draw an image starts once, after its values loaded.
	const started = useRef(initialStopped);
	const latestGenerate = useRef(requestGenerate);
	latestGenerate.current = requestGenerate;
	useEffect(() => {
		if (started.current || copying || !autoStart || !loaded || !name.trim())
			return;
		// Empty prompts ask once; saved prompts wait for their selected source.
		if (hasPrompt && !aiConfigured) return;
		started.current = true;
		void latestGenerate.current();
	}, [autoStart, loaded, aiConfigured, name, copying, hasPrompt]);

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
						ref={generateButton}
						type="button"
						size="xs"
						variant="light"
						leftSection={<IconImagePlus size={14} strokeWidth={1.75} />}
						loading={busy}
						disabled={copying}
						onClick={() => {
							requestGenerate();
						}}
						style={{ alignSelf: "flex-start" }}
					>
						{t("coloring.generateImage")} <AiPrice feature="character_image" />
					</Button>
				</Tooltip>
			</Group>
			<CopyImagePrompt
				value={prompt}
				onChange={setPrompt}
				onBusyChange={setCopying}
				readOnly={busy}
				focusRequest={focusRequest}
			/>

			<MultiButtonsModal
				opened={needsPrompt}
				title={t("coloring.emptyImagePromptTitle")}
				message={t("coloring.emptyImagePromptQuestion")}
				returnFocus={false}
				onClose={() => {
					setNeedsPrompt(false);
					generateButton.current?.focus();
				}}
				buttons={[
					{
						id: "provide",
						label: t("coloring.provideImagePrompt"),
						variant: "default",
						autoFocus: true,
						onClick: () => {
							setNeedsPrompt(false);
							setFocusRequest((value) => value + 1);
						},
					},
					{
						id: "extract",
						label: (
							<>
								{t("coloring.extractImagePrompt")}{" "}
								<LensPrice lenses={imagePrice} tone="on-brand" />
							</>
						),
						disabled: busy || !loaded || !contextLoaded || !aiConfigured,
						tooltip: aiConfigured
							? t("coloring.extractImagePromptHelp")
							: t(availabilityKey(availability)),
						onClick: () => {
							setNeedsPrompt(false);
							void generate();
						},
					},
				]}
			>
				<Text size="sm" c="dimmed">
					{t("coloring.extractImagePromptHelp")}
				</Text>
				{researchPrice > 0 && (
					<Text size="xs" c="dimmed">
						{t("cloud.researchCost", { lenses: label(researchPrice) })}
					</Text>
				)}
			</MultiButtonsModal>

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
			{revisedPrompt && revisedPrompt !== prompt && (
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
