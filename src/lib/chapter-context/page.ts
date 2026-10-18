import { browser } from "#imports";
import { sendMessage } from "@/entrypoints/background/messaging";
import { retryChapterTask } from "@/lib/ai-source/chapter-retry";
import { aiState } from "@/lib/ai-source/storage";
import { trackEvent } from "@/lib/analytics/client";
import { chapterCoverReferences } from "@/lib/chapter-cover/prompt";
import { executeLocalizedPrompt } from "@/lib/desktop-client/localized-prompt";
import { aiPrompts } from "@/lib/desktop-client/settings";
import { pageAiTasks } from "@/lib/launcher-frame/ai-tasks";
import type { NovelContentData } from "@/types/content-data";
import { nameKey } from "@/utils/arabic";
import { findContentRoot } from "@/utils/content-processor";
import { readPageText } from "@/utils/page-text";
import {
	AUTO_CHAPTER_CONTEXT_KEY,
	buildContextPrompt,
	CONTEXT_TEXT_LIMIT,
	parseContextOutput,
} from "./prompt";
import type {
	ChapterContext,
	ChapterContextRecord,
	ContinuityContext,
} from "./schema";
import { createContextView } from "./view";

type Session = {
	data: NovelContentData;
	url: string;
	view: ReturnType<typeof createContextView>;
	record?: ChapterContextRecord;
	controller: AbortController;
	jobController?: AbortController;
	token?: string;
	poll?: ReturnType<typeof setTimeout>;
	running: boolean;
	id: string;
};
let current: Session | undefined;
const alive = (session: Session) =>
	current === session &&
	session.url === window.location.href &&
	!session.controller.signal.aborted;
const key = (session: Session) => ({
	novelId: session.data.novel.id,
	chapterNumber: session.data.chapterNumber as number,
});
async function source() {
	const text = readPageText(findContentRoot(), CONTEXT_TEXT_LIMIT + 1);
	if (!text.trim() || text.length > CONTEXT_TEXT_LIMIT)
		throw new Error("Chapter is empty or exceeds the context text limit.");
	const bytes = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(`chapter-context-v1\n${text}`),
	);
	return {
		text,
		contentHash: [...new Uint8Array(bytes)]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join(""),
	};
}
export function placeChapterContext(force = false) {
	const session = current;
	if (!session || !alive(session)) return;
	const cover = document.getElementById("storylens-chapter-cover");
	if (!cover && !session.record?.context && !force) return;
	const host = session.view.host;
	if (cover) {
		if (cover.nextElementSibling !== host) cover.after(host);
	} else if (!host.isConnected) {
		const root = findContentRoot();
		if (root === document.body) root.prepend(host);
		else root.before(host);
	}
}
async function release(session: Session, token: string | undefined) {
	if (!token) return;
	if (session.token === token) session.token = undefined;
	await sendMessage("releaseChapterContext", { ...key(session), token }).catch(
		() => {},
	);
}
export function clearChapterContext() {
	const session = current;
	current = undefined;
	if (!session) return;
	session.controller.abort();
	session.jobController?.abort();
	clearTimeout(session.poll);
	void release(session, session.token);
	session.view.host.remove();
	pageAiTasks.apply({ id: session.id, state: "released", source: "page" });
}
async function read(session: Session, resume = false) {
	const record = await sendMessage("readChapterContext", key(session));
	if (!alive(session)) return;
	session.record = record;
	session.view.update(record);
	placeChapterContext();
	if (record?.generating) {
		clearTimeout(session.poll);
		session.poll = setTimeout(() => {
			void retryChapterTask(
				() => read(session, true),
				session.controller.signal,
				() => {},
			).catch(() => {});
		}, 5000);
	} else if (resume && !session.running && !record?.context) {
		const stored = await browser.storage.local.get(AUTO_CHAPTER_CONTEXT_KEY);
		if (alive(session) && stored[AUTO_CHAPTER_CONTEXT_KEY] === true)
			void generate(session, true);
	}
}
async function generate(session: Session, automatic: boolean) {
	if (
		current !== session ||
		session.url !== window.location.href ||
		session.running
	)
		return;
	const controller = new AbortController();
	session.jobController = controller;
	const id = crypto.randomUUID();
	session.id = id;
	let token: string | undefined;
	const isCurrent = () =>
		alive(session) &&
		session.jobController === controller &&
		!controller.signal.aborted;
	session.running = true;
	session.view.clearError();
	session.view.working(true);
	placeChapterContext(true);
	let generated: { contentHash: string; context: ChapterContext } | undefined;
	try {
		await retryChapterTask(
			async () => {
				try {
					session.view.working(true);
					const state = await aiState("chapter_context");
					if (!state.user || state.user.isGuest || !state.availability.ok)
						throw new Error("Chapter context AI is unavailable.");
					const { text, contentHash } = await source();
					if (!isCurrent()) return;
					const claim = await sendMessage("claimChapterContext", {
						...key(session),
						contentHash,
						language: session.data.language,
						onlyIfMissing: automatic,
						regenerate: !automatic,
					});
					if (claim.token) {
						token = claim.token;
						if (isCurrent()) session.token = claim.token;
					}
					if (!isCurrent()) {
						await release(session, token);
						return;
					}
					if (!claim.token) {
						await read(session);
						return;
					}
					pageAiTasks.apply({
						id,
						state: "working",
						operation: "generate-context",
						subject:
							session.data.language === "ar" ? "سياق الفصل" : "Chapter context",
						source: "page",
					});
					trackEvent("ai_chapter_context_requested", {
						provider: state.source,
						automatic,
					});
					const keywords = await sendMessage(
						"chapterCoverKeywords",
						session.data.novel.id,
					).catch(() => session.data.keywords);
					const names = new Set(
						chapterCoverReferences(
							{
								...session.data,
								keywords: keywords ?? session.data.keywords,
							},
							text,
						).flatMap((row) => row.names.map(nameKey)),
					);
					const relevantKeywords = (keywords ?? session.data.keywords).filter(
						(keyword) =>
							[
								keyword.nameAr,
								keyword.nameEn,
								...keyword.aliases.flatMap((alias) => [
									alias.nameAr,
									alias.nameEn,
								]),
							].some((name) => name && names.has(nameKey(name))),
					);
					let registry = "";
					for (const keyword of relevantKeywords) {
						const line = JSON.stringify({
							id: keyword.id,
							names: [
								keyword.nameAr,
								keyword.nameEn,
								...keyword.aliases.flatMap((alias) => [
									alias.nameAr,
									alias.nameEn,
								]),
							].filter(Boolean),
						});
						if (registry.length + line.length > 10000) break;
						registry += `${line}\n`;
					}
					const entityKeys = relevantKeywords
						.map((keyword) => `keyword:${keyword.id}`)
						.slice(0, 80);
					let context: ChapterContext;
					if (generated?.contentHash === contentHash)
						context = generated.context;
					else {
						const [prompts, history] = await Promise.all([
							aiPrompts(),
							sendMessage("contextHistory", {
								...key(session),
								entityKeys,
								text,
							}).catch(
								(): ContinuityContext => ({
									chapters: [],
									lastMentions: [],
									persistentState: [],
								}),
							),
						]);
						if (!isCurrent()) return;
						context = await executeLocalizedPrompt({
							feature: "chapter_context",
							novelId: session.data.novel.id,
							prompt: buildContextPrompt(
								session.data,
								text,
								registry,
								prompts.chapterContextPrompt,
								history,
							),
							language: session.data.language,
							signal: controller.signal,
							parse: parseContextOutput,
							texts: (result) => [result.summary],
						});
					}
					if (!isCurrent()) return;
					generated = { contentHash, context };
					await sendMessage("publishChapterContext", {
						...key(session),
						contentHash,
						language: session.data.language,
						token: claim.token,
						context,
					});
					if (session.token === token) session.token = undefined;
					token = undefined;
					if (!isCurrent()) return;
					session.record = {
						context,
						contentHash,
						generating: false,
						inactiveEntities: [],
					};
					session.view.update(session.record);
					session.view.clearError();
					placeChapterContext(true);
					pageAiTasks.apply({
						id,
						state: "done",
						operation: "generate-context",
						subject:
							session.data.language === "ar" ? "سياق الفصل" : "Chapter context",
						source: "page",
					});
					trackEvent("ai_chapter_context_saved");
					await read(session).catch(() => {});
				} finally {
					await release(session, token);
					token = undefined;
				}
			},
			controller.signal,
			(error) => {
				if (!isCurrent()) {
					controller.abort();
					return;
				}
				session.view.retrying(error);
			},
		);
	} catch (error) {
		if (isCurrent()) {
			session.view.error(error);
			pageAiTasks.apply({
				id,
				state: "failed",
				operation: "generate-context",
				subject:
					session.data.language === "ar" ? "سياق الفصل" : "Chapter context",
				source: "page",
			});
		}
	} finally {
		await release(session, token);
		if (session.jobController === controller) {
			session.running = false;
			session.jobController = undefined;
			if (alive(session)) session.view.working(false);
		}
		pageAiTasks.apply({ id, state: "released", source: "page" });
	}
}
export function syncChapterContext(data: NovelContentData) {
	if (
		data.chapterNumber === undefined ||
		!Number.isInteger(data.chapterNumber) ||
		data.chapterNumber < 0
	) {
		clearChapterContext();
		return;
	}
	if (
		current?.data.novel.id === data.novel.id &&
		current.data.chapterNumber === data.chapterNumber &&
		alive(current)
	) {
		placeChapterContext();
		return;
	}
	clearChapterContext();
	const controller = new AbortController();
	const view = createContextView(
		data.language,
		() => {
			if (current) void generate(current, false);
		},
		() => {
			if (!current) return;
			const session = current;
			session.jobController?.abort();
			session.jobController = undefined;
			session.running = false;
			void release(session, session.token);
			session.view.working(false);
			session.view.stopped();
			pageAiTasks.apply({ id: session.id, state: "released", source: "page" });
			trackEvent("ai_chapter_context_stopped");
		},
	);
	const session: Session = {
		data,
		url: window.location.href,
		view,
		controller,
		running: false,
		id: crypto.randomUUID(),
	};
	current = session;
	void (async () => {
		await retryChapterTask(
			() => read(session),
			controller.signal,
			() => {},
		);
		const ai = await aiState("chapter_context");
		if (alive(session))
			session.view.price(
				ai.source === "cloud"
					? (ai.pricing?.features.find((row) => row.key === "chapter_context")
							?.lenses ?? 0)
					: 0,
			);
		if (!alive(session)) return;
		const stored = await browser.storage.local.get(AUTO_CHAPTER_CONTEXT_KEY);
		if (stored[AUTO_CHAPTER_CONTEXT_KEY] !== true) return;
		if (
			alive(session) &&
			!session.record?.context &&
			!session.record?.generating
		)
			await generate(session, true);
	})().catch(() => {});
}
export function refreshChapterContextPreference() {
	const data = current?.data;
	if (data) {
		clearChapterContext();
		syncChapterContext(data);
	}
}
