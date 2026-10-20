import { browser } from "#imports";
import { sendMessage } from "@/entrypoints/background/messaging";
import { availabilityKey } from "@/lib/ai-source/availability";
import { retryChapterTask } from "@/lib/ai-source/chapter-retry";
import { aiState } from "@/lib/ai-source/storage";
import { trackEvent } from "@/lib/analytics/client";
import { placeChapterContext } from "@/lib/chapter-context/page";
import type { ChapterContext } from "@/lib/chapter-context/schema";
import { vanillaAiText } from "@/lib/cloud-ai/vanilla-text";
import { generateCharacterImage } from "@/lib/desktop-client/character-image-job";
import { aiPrompts } from "@/lib/desktop-client/settings";
import { pageAiTasks } from "@/lib/launcher-frame/ai-tasks";
import { createLensCoin, formatLenses } from "@/lib/lens-coin";
import type { NovelContentData } from "@/types/content-data";
import { findContentRoot } from "@/utils/content-processor";
import { readPageText } from "@/utils/page-text";
import { waitForChapterCoverContext } from "./context";
import { buildChapterCoverPrompt, chapterCoverReferences } from "./prompt";
import {
	AUTO_CHAPTER_COVER_KEY,
	type ChapterCover,
	type CoverKey,
} from "./types";
import { createCoverView } from "./view";

const words = {
	en: {
		title: "Chapter cover",
		imagePrompt: "Image Prompt",
		savePrompt: "Save prompt",
		reloadPrompt: "Discard changes",
		expandPrompt: "Expand",
		collapsePrompt: "Collapse",
		promptHelp:
			"Edit the description to tweak the next cover. Save prompt keeps your changes with this chapter without generating an image.",
		promptSaved: "Image prompt saved.",
		promptSaving: "Saving image prompt…",
		promptReadOnly:
			"Only the cover publisher or a moderator can edit this prompt.",
		generate: "Generate Chapter Cover Image",
		regenerate: "Regenerate background image",
		retrying: "Could not complete the chapter cover. Retrying automatically…",
		copy: "Copy image prompt",
		copied: "Prompt copied",
		copyFailed: "Could not copy the prompt. Try again.",
		stop: "Stop",
		stopped: "Image generation stopped.",
		actions: "Chapter cover actions",
		working: "Generating chapter cover…",
		waiting: "Another reader is generating this chapter’s cover…",
		waitingContext:
			"Waiting for the current chapter context to finish generating…",
		missingContext:
			"Waiting for chapter context. Generate the current chapter’s context below to continue.",
		missing: "No cover has been generated for this chapter.",
		ready: "Chapter cover",
		signIn:
			"Sign in to a registered Story Lens account to generate a shared cover.",
		unavailable: "Chapter content is not ready yet.",
		saveFailed:
			"The cover could not be saved. You can download it and try saving again.",
		save: "Save cover",
		download: "Download image",
	},
	ar: {
		title: "غلاف الفصل",
		imagePrompt: "وصف الصورة",
		savePrompt: "حفظ الوصف",
		reloadPrompt: "تجاهل التغييرات",
		expandPrompt: "توسيع",
		collapsePrompt: "طي",
		promptHelp:
			"عدّل الوصف لتغيير الغلاف القادم. يحفظ زر حفظ الوصف تغييراتك مع هذا الفصل دون توليد صورة.",
		promptSaved: "تم حفظ وصف الصورة.",
		promptSaving: "جارٍ حفظ وصف الصورة…",
		promptReadOnly: "يمكن لناشر الغلاف أو المشرف فقط تعديل هذا الوصف.",
		generate: "توليد صورة غلاف الفصل",
		regenerate: "إعادة توليد صورة الخلفية",
		retrying: "تعذر إكمال غلاف الفصل. ستتم إعادة المحاولة تلقائياً…",
		copy: "نسخ وصف الصورة",
		copied: "تم نسخ الوصف",
		copyFailed: "تعذر نسخ الوصف. حاول مجدداً.",
		stop: "إيقاف",
		stopped: "تم إيقاف توليد الصورة.",
		actions: "إجراءات غلاف الفصل",
		working: "جارٍ توليد غلاف الفصل…",
		waiting: "قارئ آخر يولّد غلاف هذا الفصل…",
		waitingContext: "بانتظار اكتمال توليد سياق الفصل الحالي…",
		missingContext: "بانتظار سياق الفصل. ولّد سياق الفصل الحالي أدناه للمتابعة.",
		missing: "لم يُولّد غلاف لهذا الفصل بعد.",
		ready: "غلاف الفصل",
		signIn: "سجّل الدخول بحساب عدسة القصة مسجّل لتوليد غلاف مشترك.",
		unavailable: "محتوى الفصل غير جاهز بعد.",
		saveFailed: "تعذر حفظ الغلاف. يمكنك تنزيله والمحاولة مجدداً.",
		save: "حفظ الغلاف",
		download: "تنزيل الصورة",
	},
};

type Session = {
	key: CoverKey;
	url: string;
	id: string;
	host: HTMLElement;
	mounted: boolean;
	disposeMenu: () => void;
	showError: (error: unknown) => void;
	clearError: () => void;
	status: HTMLElement;
	image: HTMLImageElement;
	generate: HTMLButtonElement;
	regenerate: HTMLButtonElement;
	copy: HTMLButtonElement;
	stop: HTMLButtonElement;
	download: HTMLAnchorElement;
	save: HTMLButtonElement;
	promptSection: HTMLDetailsElement;
	promptInput: HTMLTextAreaElement;
	promptCopy: HTMLButtonElement;
	promptSave: HTMLButtonElement;
	promptReload: HTMLButtonElement;
	promptFeedback: HTMLElement;
	controller: AbortController;
	prompt: string;
	savedPrompt: string;
	promptUpdatedAt?: string | null;
	canEditPrompt: boolean;
	canRegenerate: boolean;
	savingPrompt: boolean;
	pendingPublication: boolean;
	token?: string;
	poll?: ReturnType<typeof setTimeout>;
	objectUrl?: string;
	generated?: Awaited<ReturnType<typeof generateCharacterImage>>;
	imageId?: string;
	working: boolean;
	waiting: boolean;
	automatic: boolean;
	locale: "en" | "ar";
};
let context: NovelContentData | undefined;
let current: Session | undefined;
const alive = (session: Session) =>
	current === session &&
	(!session.mounted || session.host.isConnected) &&
	session.url === window.location.href;

function endTask(session: Session, state: "done" | "failed") {
	pageAiTasks.apply({
		id: session.id,
		state,
		operation: "generate-image",
		subject: words[session.locale].title,
		source: "page",
	});
	pageAiTasks.apply({ id: session.id, state: "released", source: "page" });
}
async function release(session: Session) {
	if (!session.token) return;
	const token = session.token;
	session.token = undefined;
	await sendMessage("chapterCover", {
		...session.key,
		action: "release",
		token,
	}).catch(() => {});
}
function dispose(session: Session) {
	session.controller.abort();
	session.disposeMenu();
	clearTimeout(session.poll);
	void release(session);
	pageAiTasks.apply({ id: session.id, state: "released", source: "page" });
	if (session.objectUrl) URL.revokeObjectURL(session.objectUrl);
	session.host.remove();
}
export function clearChapterCover() {
	if (current) dispose(current);
	current = undefined;
	context = undefined;
}
function updatePromptControls(session: Session) {
	const locked =
		session.working ||
		session.waiting ||
		session.savingPrompt ||
		session.pendingPublication;
	session.promptInput.readOnly = locked || !session.canEditPrompt;
	session.regenerate.disabled =
		session.working ||
		session.waiting ||
		session.savingPrompt ||
		!session.canRegenerate;
	session.generate.disabled =
		session.working || session.waiting || session.savingPrompt;
	session.copy.disabled = !session.prompt.trim();
	session.promptCopy.disabled = session.copy.disabled;
	const dirty = session.prompt !== session.savedPrompt;
	session.promptSave.disabled =
		locked || !session.canEditPrompt || !session.promptUpdatedAt || !dirty;
	session.promptReload.disabled = locked || !dirty;
}
function setPrompt(session: Session, prompt: string) {
	session.prompt = prompt;
	session.promptInput.value = prompt;
	updatePromptControls(session);
}
async function savePrompt(session: Session) {
	if (session.promptSave.disabled || !session.promptUpdatedAt) return;
	session.savingPrompt = true;
	updatePromptControls(session);
	session.promptFeedback.textContent = words[session.locale].promptSaving;
	try {
		const result = await sendMessage("chapterCover", {
			...session.key,
			action: "savePrompt",
			imagePrompt: session.prompt,
			baseUpdatedAt: session.promptUpdatedAt,
		});
		if (!alive(session)) return;
		showCover(session, result, true);
		session.promptFeedback.textContent = words[session.locale].promptSaved;
	} catch (error) {
		if (alive(session)) {
			session.showError(error);
			session.promptFeedback.textContent =
				error instanceof Error ? error.message : String(error);
		}
	} finally {
		session.savingPrompt = false;
		if (alive(session)) updatePromptControls(session);
	}
}
function busy(session: Session, working: boolean) {
	session.working = working;
	session.generate.disabled = working || session.waiting;
	session.regenerate.disabled = working || session.waiting;
	session.stop.hidden = !working;
	session.stop.disabled = false;
	session.save.disabled = working;
	session.image.setAttribute("aria-busy", String(working));
	updatePromptControls(session);
}
function attachCover(session: Session) {
	if (session.mounted) return;
	const root = findContentRoot();
	if (root === document.body) root.prepend(session.host);
	else root.before(session.host);
	session.mounted = true;
	placeChapterContext();
}
function showCover(
	session: Session,
	cover: ChapterCover,
	acceptPrompt = false,
) {
	const text = words[session.locale];
	session.waiting = cover.generating;
	const dirty = session.prompt !== session.savedPrompt;
	if (
		cover.imagePrompt !== undefined &&
		(acceptPrompt || (!dirty && !session.pendingPublication))
	) {
		session.savedPrompt = cover.imagePrompt ?? "";
		session.promptUpdatedAt = cover.promptUpdatedAt;
		setPrompt(session, session.savedPrompt);
	}
	session.canEditPrompt = cover.canEditPrompt ?? false;
	session.canRegenerate = cover.canEditPrompt ?? true;
	if (!session.canEditPrompt && cover.image)
		session.promptFeedback.textContent = text.promptReadOnly;
	updatePromptControls(session);
	if (cover.image) {
		if (!cover.generating) session.clearError();
		session.image.src = cover.image.url;
		session.image.hidden = false;
		session.host.setAttribute("data-ready", "");
		session.download.href = cover.image.url;
		session.download.hidden = false;
		session.generate.hidden = true;
		session.regenerate.hidden = false;
		session.regenerate.disabled =
			session.working ||
			session.waiting ||
			session.savingPrompt ||
			!session.canRegenerate;
		session.status.textContent = "";
		attachCover(session);
		return true;
	}
	if (!session.automatic) attachCover(session);
	session.status.textContent = cover.generating ? text.waiting : text.missing;
	session.generate.disabled = cover.generating;
	return false;
}
function waitForCover(session: Session) {
	clearTimeout(session.poll);
	session.poll = setTimeout(async () => {
		try {
			const result = await sendMessage("chapterCover", {
				...session.key,
				action: "read",
			});
			if (!alive(session)) return;
			showCover(session, result);
			if (!result.generating) {
				if (!result.image && context) {
					const stored = await browser.storage.local.get(
						AUTO_CHAPTER_COVER_KEY,
					);
					if (
						alive(session) &&
						(!session.automatic || stored[AUTO_CHAPTER_COVER_KEY] === true)
					)
						void generate(session, context);
				}
				return;
			}
		} catch {
			if (!alive(session)) return;
		}
		waitForCover(session);
	}, 10_000);
}
async function publish(session: Session) {
	if (!session.generated || !session.token || !session.imageId) return;
	const cover = await sendMessage("chapterCover", {
		...session.key,
		action: "publish",
		token: session.token,
		imageId: session.imageId,
		data: session.generated.data,
		mimeType: session.generated.mimeType,
		imagePrompt: session.generated.prompt,
	});
	session.token = undefined;
	if (!alive(session) || session.controller.signal.aborted) return;
	session.save.hidden = true;
	session.pendingPublication = false;
	showCover(session, cover, true);
}
async function generate(
	session: Session,
	data: NovelContentData,
	regenerate = false,
) {
	if (session.working || session.savingPrompt) return;
	const text = words[session.locale];
	session.controller = new AbortController();
	const { signal } = session.controller;
	const description = session.prompt.trim() ? session.prompt : undefined;
	attachCover(session);
	busy(session, true);
	session.status.textContent = text.working;
	session.clearError();
	pageAiTasks.apply({
		id: session.id,
		state: "working",
		operation: "generate-image",
		subject: `${text.title} ${session.key.chapterNumber}`,
		source: "page",
	});
	try {
		await retryChapterTask(
			async () => {
				try {
					session.status.textContent = text.working;
					const state = await aiState("chapter_cover");
					if (!alive(session) || signal.aborted) return;
					if (!state.user || state.user.isGuest) throw new Error(text.signIn);
					if (!state.availability.ok)
						throw new Error(
							vanillaAiText(session.locale)(
								availabilityKey(state.availability),
							),
						);
					let prepared: Awaited<ReturnType<typeof preparePrompt>> | undefined;
					if (!session.generated && !description) {
						const chapterContext = await waitForChapterCoverContext({
							read: () => sendMessage("readChapterContext", session.key),
							signal,
							onWaiting: (generating) => {
								if (!alive(session)) {
									session.controller.abort();
									return;
								}
								session.status.textContent = generating
									? text.waitingContext
									: text.missingContext;
							},
						});
						if (signal.aborted || !alive(session)) return;
						prepared = await preparePrompt(data, chapterContext);
						session.clearError();
						session.status.textContent = text.working;
					}
					if (description && !session.generated) {
						const keywords = await sendMessage(
							"chapterCoverKeywords",
							data.novel.id,
						).catch(() => data.keywords);
						prepared = {
							prompt: description,
							referenceImageUrls: [
								...new Set(
									chapterCoverReferences(
										{
											...data,
											keywords: Array.isArray(keywords)
												? keywords
												: data.keywords,
										},
										readPageText(findContentRoot(), 120_000),
									).flatMap((row) => (row.imageUrl ? [row.imageUrl] : [])),
								),
							].slice(0, 8),
						};
					}
					if (signal.aborted || !alive(session)) return;
					const claim = await sendMessage("chapterCover", {
						...session.key,
						action: "claim",
						regenerate,
					});
					if (claim.token) session.token = claim.token;
					if (!alive(session) || signal.aborted) {
						await release(session);
						return;
					}
					if (!session.token) {
						showCover(session, claim);
						endTask(session, "done");
						if (claim.generating) waitForCover(session);
						return;
					}
					pageAiTasks.apply({
						id: session.id,
						state: "working",
						operation: "generate-image",
						subject: `${text.title} ${session.key.chapterNumber}`,
						source: "page",
					});
					trackEvent("ai_chapter_cover_requested", {
						provider: state.source,
						automatic: session.automatic,
					});

					if (!session.generated) {
						const result = await generateCharacterImage({
							source: state.source,
							settings: state.desktop,
							feature: "chapter_cover",
							prompt: prepared?.prompt ?? "",
							promptIsDescription: !!description,
							referenceImageUrls: prepared?.referenceImageUrls,
							name: `chapter-${session.key.chapterNumber}-cover`,
							signal,
						});
						if (!alive(session) || signal.aborted) return;
						session.generated = result;
						session.pendingPublication = true;
						setPrompt(session, result.prompt ?? description ?? "");
						session.imageId = crypto.randomUUID();
						if (session.objectUrl) URL.revokeObjectURL(session.objectUrl);
						session.objectUrl = URL.createObjectURL(result.file);
						session.image.src = session.objectUrl;
						session.image.hidden = false;
						session.host.setAttribute("data-ready", "");
						session.download.href = session.objectUrl;
						session.download.download = result.file.name;
						session.download.hidden = false;
						session.regenerate.hidden = false;
					}
					await publish(session);
					if (signal.aborted || !alive(session)) return;
					endTask(session, "done");
				} finally {
					await release(session);
				}
			},
			signal,
			(error) => {
				if (!alive(session)) {
					session.controller.abort();
					return;
				}
				session.showError(error);
				session.status.textContent = text.retrying;
				session.save.hidden = !session.generated;
			},
		);
	} catch {
		// Stop and disposal cancel both the active request and the retry delay.
	} finally {
		if (alive(session)) {
			session.save.hidden = !session.pendingPublication;
			busy(session, false);
			session.generate.hidden = !!session.generated || !session.image.hidden;
		}
	}
}

async function mount(data: NovelContentData, manual: boolean) {
	if (
		data.chapterNumber === undefined ||
		!Number.isInteger(data.chapterNumber) ||
		data.chapterNumber < 0
	)
		return;
	if (
		current &&
		current.key.novelId === data.novel.id &&
		current.key.chapterNumber === data.chapterNumber &&
		alive(current)
	) {
		if (manual) {
			current.automatic = false;
			if (current.waiting) attachCover(current);
			if (
				current.image.hidden &&
				!current.working &&
				!current.generate.disabled
			)
				void generate(current, data);
			current.host.scrollIntoView({ block: "start" });
		}
		return;
	}
	if (current) dispose(current);
	const locale = data.language;
	const text = words[locale];
	const view = createCoverView(locale, data.chapterNumber, text);
	const { status, generate: start, regenerate, copy, stop, save } = view;
	const session: Session = {
		key: { novelId: data.novel.id, chapterNumber: data.chapterNumber },
		id: crypto.randomUUID(),
		url: window.location.href,
		...view,
		mounted: false,
		controller: new AbortController(),
		prompt: "",
		savedPrompt: "",
		canEditPrompt: false,
		canRegenerate: true,
		savingPrompt: false,
		pendingPublication: false,
		working: false,
		waiting: false,
		automatic: !manual,
		locale,
	};
	current = session;
	start.addEventListener("click", () => {
		session.automatic = false;
		void generate(session, data);
	});
	regenerate.addEventListener("click", () => {
		if (
			session.working ||
			session.waiting ||
			session.savingPrompt ||
			!session.canRegenerate
		)
			return;
		session.automatic = false;
		session.generated = undefined;
		session.pendingPublication = false;
		session.imageId = undefined;
		session.save.hidden = true;
		void generate(session, data, true);
	});
	stop.addEventListener("click", () => {
		if (!session.working) return;
		session.controller.abort();
		void release(session);
		endTask(session, "failed");
		session.stop.disabled = true;
		status.textContent = text.stopped;
		trackEvent("ai_chapter_cover_stopped", {});
	});
	const copyPrompt = async () => {
		try {
			if (!session.prompt) return;
			await navigator.clipboard.writeText(session.prompt);
			if (alive(session)) {
				copy.textContent = text.copied;
				session.promptFeedback.textContent = text.copied;
			}
			trackEvent("ai_image_prompt_copied", {});
		} catch (error) {
			if (alive(session)) {
				session.showError(error);
				status.textContent = text.copyFailed;
			}
		}
	};
	copy.addEventListener("click", copyPrompt);
	session.promptCopy.addEventListener("click", copyPrompt);
	session.promptInput.addEventListener("input", () => {
		if (session.promptInput.readOnly) return;
		session.prompt = session.promptInput.value;
		session.promptFeedback.textContent = "";
		copy.textContent = text.copy;
		updatePromptControls(session);
	});
	session.promptSave.addEventListener("click", () => {
		void savePrompt(session);
	});
	session.promptReload.addEventListener("click", async () => {
		if (session.promptReload.disabled) return;
		session.savingPrompt = true;
		updatePromptControls(session);
		try {
			const cover = await sendMessage("chapterCover", {
				...session.key,
				action: "read",
			});
			if (alive(session)) {
				showCover(session, cover, true);
				session.clearError();
				session.promptFeedback.textContent = "";
			}
		} catch (error) {
			if (alive(session)) session.showError(error);
		} finally {
			session.savingPrompt = false;
			if (alive(session)) updatePromptControls(session);
		}
	});
	save.addEventListener("click", () => {
		void generate(session, data, true);
	});
	try {
		const [cover, state] = await retryChapterTask(
			() =>
				Promise.all([
					sendMessage("chapterCover", { ...session.key, action: "read" }),
					aiState("chapter_cover"),
				]),
			session.controller.signal,
			(error) => {
				if (!alive(session)) {
					session.controller.abort();
					return;
				}
				if (manual) attachCover(session);
				session.showError(error);
				status.textContent = text.retrying;
			},
		);
		copy.disabled = !session.prompt;
		if (!alive(session)) return;
		const price =
			state.source === "cloud"
				? state.pricing?.features.find((row) => row.key === "chapter_cover")
						?.lenses
				: undefined;
		if (price && price > 0) {
			for (const button of [start, regenerate]) {
				button.append(
					" ",
					createLensCoin(14),
					` ${formatLenses(price, locale)}`,
				);
			}
			start.setAttribute(
				"aria-label",
				`${text.generate}, ${vanillaAiText(locale)("lens.count", { count: price, formatted: formatLenses(price, locale) })}`,
			);
		}
		const ready = showCover(session, cover);
		if (ready && !cover.generating) return;
		if (cover.generating) {
			waitForCover(session);
			return;
		}
		if (
			manual ||
			!session.automatic ||
			(await browser.storage.local.get(AUTO_CHAPTER_COVER_KEY))[
				AUTO_CHAPTER_COVER_KEY
			] === true
		)
			await generate(session, data);
		else {
			dispose(session);
			current = undefined;
		}
	} catch (error) {
		if (alive(session)) {
			if (manual || !session.automatic) {
				attachCover(session);
				start.disabled = false;
				session.showError(error);
				status.textContent =
					error instanceof Error ? error.message : text.unavailable;
			} else {
				dispose(session);
				current = undefined;
			}
		}
	}
}

/** Called after the detected chapter content is ready, including when the launcher is hidden. */
export function syncChapterCover(data: NovelContentData) {
	context = data;
	void mount(data, false);
}
export function startChapterCover(): boolean {
	if (context && context.chapterNumber !== undefined) {
		void mount(context, true);
		return true;
	}
	return false;
}
export function refreshChapterCoverPreference() {
	void browser.storage.local.get(AUTO_CHAPTER_COVER_KEY).then((stored) => {
		if (
			stored[AUTO_CHAPTER_COVER_KEY] !== true &&
			current?.automatic &&
			current.working
		)
			current.stop.click();
		if (context) syncChapterCover(context);
	});
}

/** Cover context includes both languages, independently of the highlight filter. */
async function preparePrompt(
	data: NovelContentData,
	chapterContext: ChapterContext,
) {
	const [prompts, keywords] = await Promise.all([
		aiPrompts(),
		sendMessage("chapterCoverKeywords", data.novel.id).catch(
			() => data.keywords,
		),
	]);
	const chapterText = readPageText(findContentRoot(), 120_000);
	if (!chapterText.trim()) throw new Error(words[data.language].unavailable);
	return buildChapterCoverPrompt(
		{ ...data, keywords: Array.isArray(keywords) ? keywords : data.keywords },
		chapterText,
		prompts.chapterCoverPrompt,
		chapterContext,
	);
}
