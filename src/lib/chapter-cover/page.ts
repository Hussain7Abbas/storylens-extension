import { browser } from "#imports";
import { sendMessage } from "@/entrypoints/background/messaging";
import { availabilityKey } from "@/lib/ai-source/availability";
import { aiState } from "@/lib/ai-source/storage";
import { trackEvent } from "@/lib/analytics/client";
import { aiErrorMessage } from "@/lib/cloud-ai/top-up";
import { vanillaAiText } from "@/lib/cloud-ai/vanilla-text";
import { generateCharacterImage } from "@/lib/desktop-client/character-image-job";
import { aiPrompts } from "@/lib/desktop-client/settings";
import { pageAiTasks } from "@/lib/launcher-frame/ai-tasks";
import { createLensCoin, formatLenses } from "@/lib/lens-coin";
import type { NovelContentData } from "@/types/content-data";
import { findContentRoot } from "@/utils/content-processor";
import { readPageText } from "@/utils/page-text";
import { buildChapterCoverPrompt } from "./prompt";
import {
	AUTO_CHAPTER_COVER_KEY,
	type ChapterCover,
	type CoverKey,
} from "./types";
import { createCoverView } from "./view";

const words = {
	en: {
		title: "Chapter cover",
		generate: "Generate Chapter Cover Image",
		copy: "Copy image prompt",
		copied: "Prompt copied",
		copyFailed: "Could not copy the prompt. Try again.",
		stop: "Stop",
		stopped: "Image generation stopped.",
		actions: "Chapter cover actions",
		working: "Generating chapter cover…",
		waiting: "Another reader is generating this chapter’s cover…",
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
		generate: "توليد صورة غلاف الفصل",
		copy: "نسخ وصف الصورة",
		copied: "تم نسخ الوصف",
		copyFailed: "تعذر نسخ الوصف. حاول مجدداً.",
		stop: "إيقاف",
		stopped: "تم إيقاف توليد الصورة.",
		actions: "إجراءات غلاف الفصل",
		working: "جارٍ توليد غلاف الفصل…",
		waiting: "قارئ آخر يولّد غلاف هذا الفصل…",
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
	status: HTMLElement;
	image: HTMLImageElement;
	generate: HTMLButtonElement;
	copy: HTMLButtonElement;
	stop: HTMLButtonElement;
	download: HTMLAnchorElement;
	save: HTMLButtonElement;
	controller: AbortController;
	prompt: string;
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
function busy(session: Session, working: boolean) {
	session.working = working;
	session.generate.disabled = working || session.waiting;
	session.stop.hidden = !working || !!session.generated;
	session.stop.disabled = false;
	session.save.disabled = working;
	session.image.setAttribute("aria-busy", String(working));
}
function attachCover(session: Session) {
	if (session.mounted) return;
	const root = findContentRoot();
	if (root === document.body) root.prepend(session.host);
	else root.before(session.host);
	session.mounted = true;
}
function showCover(session: Session, cover: ChapterCover) {
	const text = words[session.locale];
	session.waiting = cover.generating;
	if (cover.image) {
		session.image.src = cover.image.url;
		session.image.hidden = false;
		session.host.setAttribute("data-ready", "");
		session.download.href = cover.image.url;
		session.download.hidden = false;
		session.generate.hidden = true;
		session.status.textContent = "";
		attachCover(session);
		return true;
	}
	if (!session.automatic) attachCover(session);
	session.status.textContent = cover.generating ? text.waiting : text.missing;
	session.generate.disabled = cover.generating;
	return false;
}
function waitForCover(session: Session, until = Date.now() + 32 * 60_000) {
	clearTimeout(session.poll);
	if (Date.now() > until) {
		session.generate.disabled = false;
		return;
	}
	session.poll = setTimeout(async () => {
		try {
			const result = await sendMessage("chapterCover", {
				...session.key,
				action: "read",
			});
			if (!alive(session)) return;
			if (showCover(session, result) || !result.generating) return;
		} catch {
			if (!alive(session)) return;
		}
		waitForCover(session, until);
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
	});
	session.token = undefined;
	if (!alive(session)) return;
	session.save.hidden = true;
	showCover(session, cover);
}
async function generate(session: Session, data: NovelContentData) {
	if (session.working || !session.prompt.trim()) return;
	const text = words[session.locale];
	session.controller = new AbortController();
	const { signal } = session.controller;
	attachCover(session);
	busy(session, true);
	session.status.textContent = text.working;
	try {
		const state = await aiState("chapter_cover");
		if (!alive(session) || signal.aborted) return;
		if (!state.user || state.user.isGuest) throw new Error(text.signIn);
		if (!state.availability.ok)
			throw new Error(
				vanillaAiText(session.locale)(availabilityKey(state.availability)),
			);
		const prepared = await preparePrompt(data);
		session.prompt = prepared.prompt;
		session.copy.disabled = false;
		if (signal.aborted || !alive(session)) return;
		const claim = await sendMessage("chapterCover", {
			...session.key,
			action: "claim",
		});
		if (claim.token) session.token = claim.token;
		if (!alive(session) || signal.aborted) {
			await release(session);
			return;
		}
		if (!session.token) {
			showCover(session, claim);
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

		const result = await generateCharacterImage({
			source: state.source,
			settings: state.desktop,
			feature: "chapter_cover",
			prompt: session.prompt,
			referenceImageUrls: prepared.referenceImageUrls,
			name: `chapter-${session.key.chapterNumber}-cover`,
			signal,
		});
		if (!alive(session) || signal.aborted) return;
		session.stop.hidden = true;
		session.generated = result;
		session.imageId = crypto.randomUUID();
		session.objectUrl = URL.createObjectURL(result.file);
		session.image.src = session.objectUrl;
		session.image.hidden = false;
		session.host.setAttribute("data-ready", "");
		session.download.href = session.objectUrl;
		session.download.download = result.file.name;
		session.download.hidden = false;
		try {
			await publish(session);
		} catch {
			if (alive(session)) {
				session.status.textContent = text.saveFailed;
				session.save.hidden = false;
			}
		}
		endTask(session, "done");
	} catch (error) {
		if (alive(session) && !signal.aborted) {
			session.status.textContent = session.automatic
				? error instanceof Error
					? error.message
					: text.unavailable
				: await aiErrorMessage(
						error,
						"chapter_cover",
						vanillaAiText(session.locale),
					);
			endTask(session, "failed");
		}
	} finally {
		if (!session.generated) await release(session);
		if (alive(session)) {
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
	const { status, generate: start, copy, stop, save } = view;
	const session: Session = {
		key: { novelId: data.novel.id, chapterNumber: data.chapterNumber },
		id: crypto.randomUUID(),
		url: window.location.href,
		...view,
		mounted: false,
		controller: new AbortController(),
		prompt: "",
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
	stop.addEventListener("click", () => {
		if (!session.working) return;
		session.controller.abort();
		void release(session);
		endTask(session, "failed");
		session.stop.disabled = true;
		status.textContent = text.stopped;
		trackEvent("ai_chapter_cover_stopped", {});
	});
	copy.addEventListener("click", async () => {
		try {
			await navigator.clipboard.writeText(session.prompt);
			if (alive(session)) copy.textContent = text.copied;
			trackEvent("ai_image_prompt_copied", {});
		} catch {
			if (alive(session)) status.textContent = text.copyFailed;
		}
	});
	save.addEventListener("click", async () => {
		busy(session, true);
		try {
			await publish(session);
		} catch {
			status.textContent = text.saveFailed;
		} finally {
			if (alive(session)) busy(session, false);
		}
	});
	try {
		const prepared = await preparePrompt(data);
		if (!alive(session)) return;
		session.prompt = prepared.prompt;
		copy.disabled = false;
		const [cover, state] = await Promise.all([
			sendMessage("chapterCover", { ...session.key, action: "read" }),
			aiState("chapter_cover"),
		]);
		if (!alive(session)) return;
		const price =
			state.source === "cloud"
				? state.pricing?.features.find((row) => row.key === "chapter_cover")
						?.lenses
				: undefined;
		if (price && price > 0) {
			start.append(" ", createLensCoin(14), ` ${formatLenses(price, locale)}`);
			start.setAttribute(
				"aria-label",
				`${text.generate}, ${vanillaAiText(locale)("lens.count", { count: price, formatted: formatLenses(price, locale) })}`,
			);
		}
		if (showCover(session, cover)) return;
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
async function preparePrompt(data: NovelContentData) {
	const [prompts, keywords] = await Promise.all([
		aiPrompts(),
		sendMessage("chapterCoverKeywords", data.novel.id).catch(
			() => data.keywords,
		),
	]);
	return buildChapterCoverPrompt(
		{ ...data, keywords: Array.isArray(keywords) ? keywords : data.keywords },
		readPageText(findContentRoot(), 120_000),
		prompts.chapterCoverPrompt,
	);
}
