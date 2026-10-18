import {
	CHAPTER_ERROR_DETAILS_CSS,
	createChapterErrorDetails,
} from "@/lib/ai-source/chapter-error-details";
import {
	createLensCoin,
	formatLenses,
	LENS_COIN_MOTION_CSS,
} from "@/lib/lens-coin";
import { contentThemeCss } from "@/styles/palette";
import type { ChapterContextRecord } from "./schema";

const labels = {
	en: {
		title: "Chapter context",
		name: "Name",
		missing: "No chapter context has been generated yet.",
		generate: "Generate chapter context",
		regenerate: "Regenerate context",
		retrying: "Could not complete chapter context. Retrying automatically…",
		working: "Generating chapter context…",
		summary: "Summary",
		scenes: "Scenes",
		environment: "Environment",
		entities: "Entities",
		stateChanges: "Lasting changes",
		inactive: "Recently absent entities",
		last: "Last seen in chapter",
		location: "Location",
		time: "Time",
		weather: "Weather",
		lighting: "Lighting",
		details: "Details",
		appearance: "Appearance",
		condition: "Condition",
		clothing: "Clothing",
		equipment: "Equipment",
		pose: "Pose",
		emotion: "Emotion",
		relations: "Relationships",
		evidence: "Evidence",
		field: "Changed detail",
		value: "New state",
		sceneId: "Scene",
		cleared: "Explicitly cleared",
		stopped: "Stopped",
		stop: "Stop",
		failed: "Could not generate chapter context. Try again.",
	},
	ar: {
		title: "سياق الفصل",
		name: "الاسم",
		missing: "لم يُولَّد سياق لهذا الفصل بعد.",
		generate: "توليد سياق الفصل",
		regenerate: "إعادة توليد السياق",
		retrying: "تعذر إكمال سياق الفصل. ستتم إعادة المحاولة تلقائياً…",
		working: "جارٍ توليد سياق الفصل…",
		summary: "الملخص",
		scenes: "المشاهد",
		environment: "البيئة",
		entities: "العناصر",
		stateChanges: "التغيّرات المستمرة",
		inactive: "عناصر غائبة مؤخراً",
		last: "آخر ظهور في الفصل",
		location: "المكان",
		time: "الوقت",
		weather: "الطقس",
		lighting: "الإضاءة",
		details: "التفاصيل",
		appearance: "المظهر",
		condition: "الحالة",
		clothing: "الملابس",
		equipment: "المعدات",
		pose: "الوضعية",
		emotion: "المشاعر",
		relations: "العلاقات",
		evidence: "الدليل",
		field: "التفصيل المتغيّر",
		value: "الحالة الجديدة",
		sceneId: "المشهد",
		cleared: "أزيل صراحةً",
		stopped: "تم الإيقاف",
		stop: "إيقاف",
		failed: "تعذر توليد سياق الفصل. حاول مجدداً.",
	},
};
export function createContextView(
	locale: "en" | "ar",
	generate: () => void,
	stop: () => void,
) {
	const text = labels[locale];
	const host = document.createElement("div");
	host.id = "storylens-chapter-context";
	host.dataset.storylensSkip = "";
	host.dir = locale === "ar" ? "rtl" : "ltr";
	host.lang = locale;
	const shadow = host.attachShadow({ mode: "open" });
	const style = document.createElement("style");
	style.textContent = `${contentThemeCss}${LENS_COIN_MOTION_CSS}${CHAPTER_ERROR_DETAILS_CSS}:host{display:block;margin-block:6px 20px;font:14px/1.7 system-ui,sans-serif;color:var(--ink)}summary{width:fit-content;color:var(--muted);font-size:12px;cursor:pointer}summary:focus-visible,button:focus-visible{outline:3px solid var(--accent);outline-offset:3px}.body{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;margin-block-start:8px;overflow-wrap:anywhere}h3,h4{margin-block:12px 4px}p{margin-block:4px 10px;white-space:pre-wrap}dl{display:grid;grid-template-columns:minmax(5em,auto) 1fr;gap:4px 12px;margin-block:6px}dt{color:var(--muted)}dd{margin:0}ul{padding-inline-start:20px}button{font:inherit;background:var(--surface);color:var(--accent);border:1px solid var(--border);border-radius:6px;min-height:36px;padding:4px 12px;cursor:pointer}button:disabled{opacity:.6;cursor:default}[hidden]{display:none!important}@media(max-width:480px){dl{grid-template-columns:1fr;gap:0}dd{margin-block-end:6px}}`;
	const details = document.createElement("details");
	const summary = document.createElement("summary");
	summary.textContent = text.title;
	const body = document.createElement("div");
	body.className = "body";
	const content = document.createElement("div");
	const status = document.createElement("p");
	status.setAttribute("role", "status");
	const button = document.createElement("button");
	button.type = "button";
	button.textContent = text.generate;
	button.addEventListener("click", generate);
	const stopButton = document.createElement("button");
	stopButton.type = "button";
	stopButton.textContent = text.stop;
	stopButton.hidden = true;
	stopButton.addEventListener("click", stop);
	const errorDetails = createChapterErrorDetails(locale);
	body.append(content, status, errorDetails.element, button, stopButton);
	details.append(summary, body);
	shadow.append(style, details);
	shadow.addEventListener("click", (event) => event.stopPropagation());
	const title = (parent: HTMLElement, value: string, level = "h3") => {
		const node = document.createElement(level);
		node.textContent = value;
		parent.append(node);
	};
	function renderObject(value: unknown): HTMLElement {
		if (Array.isArray(value)) {
			const list = document.createElement("ul");
			for (const item of value) {
				const li = document.createElement("li");
				li.append(renderObject(item));
				list.append(li);
			}
			return list;
		}
		if (value && typeof value === "object") {
			const dl = document.createElement("dl");
			for (const [key, item] of Object.entries(value)) {
				if (
					["entityKey", "keywordId", "schemaVersion", "id", "kind"].includes(
						key,
					) ||
					item === "" ||
					(Array.isArray(item) && !item.length)
				)
					continue;
				const dt = document.createElement("dt");
				dt.textContent =
					key in text
						? text[key as keyof typeof text]
						: key.replace(/([a-z])([A-Z])/gu, "$1 $2");
				const dd = document.createElement("dd");
				dd.append(renderObject(item));
				dl.append(dt, dd);
			}
			return dl;
		}
		const node = document.createElement("span");
		node.textContent = value === null ? text.cleared : String(value ?? "");
		return node;
	}
	let amount = 0;
	let hasContext = false;
	function renderButton() {
		button.textContent = hasContext ? text.regenerate : text.generate;
		if (amount > 0)
			button.append(
				" ",
				createLensCoin(14),
				` ${formatLenses(amount, locale)}`,
			);
	}
	function update(record: ChapterContextRecord | undefined) {
		content.replaceChildren();
		const context = record?.context;
		hasContext = !!context;
		renderButton();
		if (!context) {
			const p = document.createElement("p");
			p.textContent = text.missing;
			content.append(p);
			return;
		}
		title(content, text.summary);
		const p = document.createElement("p");
		p.textContent = context.summary;
		content.append(p);
		title(content, text.scenes);
		for (const scene of context.scenes) {
			title(content, scene.title, "h4");
			content.append(
				renderObject({
					environment: scene.environment,
					entities: scene.entities,
				}),
			);
		}
		if (context.stateChanges.length) {
			title(content, text.stateChanges);
			content.append(
				renderObject(
					context.stateChanges.map((change) => ({
						name:
							context.scenes
								.find((scene) => scene.id === change.sceneId)
								?.entities.find(
									(entity) => entity.entityKey === change.entityKey,
								)?.name ?? "",
						...change,
						field: change.field
							.replace(/\./gu, " › ")
							.replace(/([a-z])([A-Z])/gu, "$1 $2"),
						sceneId:
							context.scenes.find((scene) => scene.id === change.sceneId)
								?.title ?? change.sceneId,
					})),
				),
			);
		}
		if (record?.inactiveEntities?.length) {
			title(content, text.inactive);
			const list = document.createElement("ul");
			for (const entity of record?.inactiveEntities ?? []) {
				const li = document.createElement("li");
				li.textContent = `${entity.name} — ${text.last} ${entity.lastSeenChapter}`;
				list.append(li);
			}
			content.append(list);
		}
	}
	return {
		price(value: number) {
			amount = value;
			renderButton();
		},
		host,
		update,
		working(value: boolean) {
			button.disabled = value;
			stopButton.hidden = !value;
			if (value) status.textContent = text.working;
			else if (status.textContent === text.working) status.textContent = "";
		},
		clearError: errorDetails.clear,
		retrying(error: unknown) {
			errorDetails.show(error);
			status.textContent = text.retrying;
		},
		error(error: unknown) {
			errorDetails.show(error);
			status.textContent = text.failed;
		},
		stopped() {
			status.textContent = text.stopped;
		},
	};
}
