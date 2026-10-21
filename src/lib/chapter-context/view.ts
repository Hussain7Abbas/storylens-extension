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
import { INLINE_CONTEXT_EDIT_CSS, inlineContextProperty } from "./inline-edit";
import type { ChapterContextRecord } from "./schema";
import type { ContextEdit } from "./transport";

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
	edit?: (
		change: Pick<ContextEdit, "path" | "value" | "baseUpdatedAt">,
	) => Promise<ChapterContextRecord>,
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
	style.textContent += INLINE_CONTEXT_EDIT_CSS;
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
	let record: ChapterContextRecord | undefined;
	let queued: ChapterContextRecord | undefined;
	let editing = false;
	let working = false;
	let disposed = false;
	const refreshControls = () => {
		content.dataset.contextEditing = String(editing);
		button.disabled = working || editing || !!record?.generating;
		for (const node of content.querySelectorAll<HTMLButtonElement>(
			"[data-edit-context]",
		))
			node.disabled = working || editing || !!record?.generating;
	};
	const scalar = (value: unknown) => {
		const node = document.createElement("span");
		node.textContent = value === null ? text.cleared : String(value ?? "");
		return node;
	};
	function property(
		value: unknown,
		path: (string | number)[],
		label: string,
		display: HTMLElement,
	): HTMLElement {
		const revision = record?.updatedAt;
		if (!edit || !record?.canEdit || !revision) return display;
		return inlineContextProperty({
			locale,
			label,
			path,
			value,
			display,
			alive: () => !disposed,
			start: () => {
				if (disposed || editing || working || record?.generating) return false;
				editing = true;
				refreshControls();
				return true;
			},
			save: async (value) => {
				queued = await edit({ path, value, baseUpdatedAt: revision });
			},
			finish: () => {
				editing = false;
				if (queued) {
					const next = queued;
					queued = undefined;
					update(next);
				} else refreshControls();
				[...content.querySelectorAll<HTMLButtonElement>("[data-edit-context]")]
					.find((node) => node.dataset.editContext === JSON.stringify(path))
					?.focus();
			},
		});
	}
	const title = (parent: HTMLElement, value: string, level = "h3") => {
		const node = document.createElement(level);
		node.textContent = value;
		parent.append(node);
	};
	function renderObject(
		value: unknown,
		path: (string | number)[] = [],
	): HTMLElement {
		if (Array.isArray(value)) {
			const list = document.createElement("ul");
			for (const [index, item] of value.entries()) {
				const li = document.createElement("li");
				const itemPath = [...path, index];
				li.append(
					item && typeof item === "object"
						? renderObject(item, itemPath)
						: property(
								item,
								itemPath,
								`${text[path.at(-1) as keyof typeof text] ?? path.at(-1)} ${index + 1}`,
								renderObject(item, itemPath),
							),
				);
				list.append(li);
			}
			return list;
		}
		if (value && typeof value === "object") {
			const dl = document.createElement("dl");
			if (path[0] === "stateChanges" && path.length === 2 && record?.context) {
				const change = record.context.stateChanges[Number(path[1])];
				const sceneIndex = record.context.scenes.findIndex(
					(scene) => scene.id === change?.sceneId,
				);
				const entityIndex =
					record.context.scenes[sceneIndex]?.entities.findIndex(
						(entity) => entity.entityKey === change?.entityKey,
					) ?? -1;
				const entity = record.context.scenes[sceneIndex]?.entities[entityIndex];
				if (entity) {
					const dt = document.createElement("dt");
					dt.textContent = text.name;
					const dd = document.createElement("dd");
					dd.append(
						property(
							entity.name,
							["scenes", sceneIndex, "entities", entityIndex, "name"],
							text.name,
							scalar(entity.name),
						),
					);
					dl.append(dt, dd);
				}
			}
			for (const [key, item] of Object.entries(value)) {
				if (
					["entityKey", "keywordId", "schemaVersion", "id", "kind"].includes(
						key,
					) ||
					(!record?.canEdit &&
						(item === "" || (Array.isArray(item) && !item.length)))
				)
					continue;
				const dt = document.createElement("dt");
				dt.className = "context-label";
				dt.textContent =
					key in text
						? text[key as keyof typeof text]
						: key.replace(/([a-z])([A-Z])/gu, "$1 $2");
				const dd = document.createElement("dd");
				const itemPath = [...path, key];
				let display = renderObject(item, itemPath);
				if (path[0] === "stateChanges" && key === "sceneId")
					display = scalar(
						record?.context?.scenes.find((scene) => scene.id === item)?.title ??
							item,
					);
				if (
					path[0] === "stateChanges" &&
					key === "field" &&
					typeof item === "string"
				)
					display = scalar(
						item.replace(/\./gu, " › ").replace(/([a-z])([A-Z])/gu, "$1 $2"),
					);
				const field = property(item, itemPath, dt.textContent ?? key, display);
				const pencil = [...field.children].find(
					(node) =>
						node instanceof HTMLButtonElement &&
						node.hasAttribute("data-edit-context"),
				);
				if (pencil) {
					dt.append(pencil);
					field.classList.add("context-field-value");
				}
				dd.append(field);
				dl.append(dt, dd);
			}
			return dl;
		}
		return scalar(value);
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
	function update(next: ChapterContextRecord | undefined) {
		if (disposed) return;
		if (editing) {
			queued = next;
			return;
		}
		record = next;
		content.replaceChildren();
		const context = record?.context;
		hasContext = !!context;
		renderButton();
		refreshControls();
		if (!context) {
			const p = document.createElement("p");
			p.textContent = text.missing;
			content.append(p);
			return;
		}
		title(content, text.summary);
		const p = document.createElement("p");
		p.textContent = context.summary;
		content.append(property(context.summary, ["summary"], text.summary, p));
		const scenesHeading = document.createElement("h3");
		scenesHeading.textContent = text.scenes;
		content.append(
			property(context.scenes, ["scenes"], text.scenes, scenesHeading),
		);
		for (const [index, scene] of context.scenes.entries()) {
			const heading = document.createElement("h4");
			heading.textContent = scene.title;
			content.append(
				property(
					scene.title,
					["scenes", index, "title"],
					scene.title || text.scenes,
					heading,
				),
			);
			content.append(
				renderObject(
					{
						environment: scene.environment,
						entities: scene.entities,
					},
					["scenes", index],
				),
			);
		}
		if (context.stateChanges.length || record?.canEdit) {
			const changesHeading = document.createElement("h3");
			changesHeading.textContent = text.stateChanges;
			content.append(
				property(
					context.stateChanges,
					["stateChanges"],
					text.stateChanges,
					changesHeading,
				),
			);
			content.append(renderObject(context.stateChanges, ["stateChanges"]));
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
		refreshControls();
	}
	return {
		price(value: number) {
			amount = value;
			renderButton();
		},
		host,
		update,
		editing: () => editing,
		dispose() {
			disposed = true;
		},
		working(value: boolean) {
			working = value;
			refreshControls();
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
