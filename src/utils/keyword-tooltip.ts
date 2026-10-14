import { createElement, ImagePlus, Pencil, Plus, Sparkles } from "lucide";
import type { AuthUser } from "@/lib/auth/auth-store";
import {
	canCreate,
	canEditAlias,
	canEditKeyword,
	canEditVersion,
} from "@/lib/auth/permissions";
import { parseFontSize } from "@/lib/font-size";
import {
	parseTooltipTrigger,
	type TooltipTrigger,
} from "@/lib/tooltip-trigger";
import type {
	EnrichedCategory,
	EnrichedKeyword,
	EnrichedNature,
	RawKeyword,
	RawKeywordAlias,
} from "@/types/content-data";
import { closeImageModal, openImageModal } from "@/utils/image-modal";
import {
	type FieldInfo,
	pickActiveVersion,
	pickBaseVersion,
	type RawImage,
	resolveKeywordImage,
	resolveTooltipInfo,
} from "@/utils/resolve-keyword-version";
import { aliasDisplayName, type Language, nameIn } from "@/utils/translation";

const TOOLTIP_ROOT_ID = "storylens-keyword-tooltip-root";
const TOOLTIP_GAP_PX = 8;
const HIDE_DELAY_MS = 80;

type AnchorData = {
	enriched: EnrichedKeyword;
	raw: RawKeyword;
	alias: RawKeywordAlias | null;
	currentChapter: number;
	language: Language;
};

const anchorDataMap = new WeakMap<HTMLElement, AnchorData>();

let portalInitialized = false;
let pickingText = false;
let tooltipTrigger: TooltipTrigger = "click";
let tabSequence = 0;
let activeAnchor: HTMLElement | null = null;
let activeTooltip: HTMLElement | null = null;
/** Attached action box, on the tooltip edge nearest the word. */
let activeActions: HTMLElement | null = null;
let hideTimeout: ReturnType<typeof setTimeout> | null = null;
let scrollListenerAttached = false;

const TOOLTIP_STRINGS: Record<string, Record<string, string>> = {
	en: {
		original: "Original",
		addAlias: "Add alias",
		addVersion: "Add version",
		addReplacement: "Add replacement",
		pickAlias: "Pick alias name from the page",
		pickReplacement: "Pick replacement text from the page",
		info: "Info",
		aliases: "Aliases",
		versions: "Versions",
		version: "Version",
		keyword: "Keyword",
		alias: "Alias",
		showMore: "↗",
		noImage: "—",
		edit: "Edit",
		generateImage: "Generate image with AI",
		viewImage: "View full image",
		close: "Close",
	},
	ar: {
		original: "الأصل",
		addAlias: "إضافة اسم بديل",
		addVersion: "إضافة نسخة",
		addReplacement: "إضافة استبدال",
		pickAlias: "اختيار الاسم البديل من الصفحة",
		pickReplacement: "اختيار نص الاستبدال من الصفحة",
		info: "معلومات",
		aliases: "الأسماء البديلة",
		versions: "النسخ",
		version: "النسخة",
		keyword: "الكلمة",
		alias: "الاسم البديل",
		showMore: "↗",
		noImage: "—",
		edit: "تعديل",
		generateImage: "توليد صورة بالذكاء الاصطناعي",
		viewImage: "عرض الصورة كاملة",
		close: "إغلاق",
	},
};

let cachedLocale = "en";

export function setTooltipLocale(locale: string): void {
	cachedLocale = locale;
}

function getLocale(): string {
	return cachedLocale;
}

function tt(key: string): string {
	return TOOLTIP_STRINGS[cachedLocale]?.[key] ?? TOOLTIP_STRINGS.en[key] ?? key;
}

/** The entry an Edit button opens: a keyword, or one of its aliases or versions. */
export type TooltipEditTarget = {
	kind: "keyword" | "alias" | "version";
	id: string;
	/** The keyword itself, or the alias's or version's parent keyword. */
	keywordId: string;
	novelId: string;
};

export type TooltipCreateTarget = {
	keywordId: string;
	novelId: string;
	keywordName: string;
	language: Language;
};

type TooltipActions = {
	onCreate?: (kind: "alias" | "version", target: TooltipCreateTarget) => void;
	onPick?: (kind: "alias" | "replacement", target: TooltipCreateTarget) => void;
	/** Opens the entry's form; Edit buttons appear only while this is set. */
	onEdit?: (target: TooltipEditTarget) => void;
	onImageOpen?: () => void;
	/**
	 * Opens the entry's form with its AI image request already running; the
	 * hover action beside the tooltip appears only while this is set.
	 */
	onGenerateImage?: (target: TooltipEditTarget) => void;
};

let actions: TooltipActions | null = null;
let currentUser: AuthUser | null = null;

export function setTooltipActions(next: TooltipActions | null): void {
	actions = next;
}

/** Page selection owns the pointer while choosing an alias or replacement. */
export function setTooltipPicking(picking: boolean): void {
	pickingText = picking;
	if (picking) hideActiveTooltip();
}

/** Existing anchors read this preference on each event; no re-highlighting needed. */
export function setTooltipTrigger(value: unknown): void {
	const next = parseTooltipTrigger(value);
	if (next === tooltipTrigger) return;
	tooltipTrigger = next;
	hideActiveTooltip();
}

/** The signed-in reader, for the per-row edit rules. */
export function setTooltipUser(user: AuthUser | null): void {
	currentUser = user;
}

let cachedFontFace: string | null = null;
let cachedFontSize: number | null = null;

export function setTooltipFontFace(fontFace: string | null): void {
	cachedFontFace = fontFace;
	if (activeTooltip) {
		applyAppearanceToRoot(getTooltipRoot());
		handleReposition();
	}
}

export function setTooltipFontSize(fontSize: number | null): void {
	cachedFontSize = fontSize === null ? null : parseFontSize(fontSize);
	if (activeTooltip) {
		applyAppearanceToRoot(getTooltipRoot());
		handleReposition();
	}
}

function applyAppearanceToRoot(root: HTMLElement): void {
	if (cachedFontFace && cachedFontFace !== "Default") {
		root.style.setProperty("--storylens-font-face", cachedFontFace);
	} else {
		root.style.removeProperty("--storylens-font-face");
	}

	if (cachedFontSize !== null) {
		root.style.setProperty("--storylens-font-size", `${cachedFontSize}px`);
	} else {
		root.style.removeProperty("--storylens-font-size");
	}
}

function getLocalizedName(obj: {
	nameEn?: string | null;
	nameAr?: string | null;
}): string {
	const locale = getLocale();
	if (locale === "ar") return obj.nameAr || obj.nameEn || "";
	return obj.nameEn || obj.nameAr || "";
}

function getTooltipRoot(): HTMLElement {
	const existing = document.getElementById(TOOLTIP_ROOT_ID);
	if (existing) {
		return existing;
	}

	const root = document.createElement("div");
	root.id = TOOLTIP_ROOT_ID;
	root.className = "storylens-keyword-tooltip-root";
	document.body.appendChild(root);
	return root;
}

/** An Edit button for a row the reader may change, or null when there is none to show. */
function buildEditButton(
	target: TooltipEditTarget,
	allowed: boolean,
): HTMLButtonElement | null {
	if (!actions?.onEdit || !allowed) return null;

	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = "storylens-edit-btn";
	btn.dataset.editKind = target.kind;
	btn.append(
		createElement(Pencil, {
			width: 12,
			height: 12,
			"aria-hidden": "true",
			"stroke-width": 1.75,
		}),
		document.createTextNode(tt("edit")),
	);
	btn.addEventListener("click", (e) => {
		e.stopPropagation();
		hideActiveTooltip();
		actions?.onEdit?.(target);
	});
	return btn;
}

/** Wraps a tooltip image in a button that opens it at full size. */
function buildImageButton(image: HTMLImageElement): HTMLButtonElement {
	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = "storylens-image-btn";
	btn.setAttribute("aria-label", tt("viewImage"));
	btn.title = tt("viewImage");
	btn.append(image);
	btn.addEventListener("click", (e) => {
		e.stopPropagation();
		hideActiveTooltip();
		openImageModal(image.src, image.alt, tt("close"));
		actions?.onImageOpen?.();
	});
	return btn;
}

/**
 * A small image for a row in the Aliases or Versions list. `inherited` dims an
 * image the row does not own but shows through the keyword's fallback chain.
 */
function buildRowThumb(
	image: RawImage,
	label: string,
	inherited: boolean,
): HTMLElement | null {
	if (!image?.url) return null;
	const thumb = document.createElement("img");
	thumb.className = "storylens-panel-item-thumb";
	thumb.src = image.url;
	thumb.alt = label;
	thumb.loading = "lazy";
	const button = buildImageButton(thumb);
	button.classList.add("storylens-panel-item-thumb-btn");
	if (inherited) button.classList.add("storylens-inherited");
	return button;
}

// Build a "show more" toggle with expandable provenance rows.
function buildShowMoreToggle<T>(
	info: FieldInfo<T>,
	renderValue: (v: T | null) => string | null,
	onToggle: () => void,
): HTMLElement | null {
	const relevantOverrides = info.overrides
		.map((o) => ({ source: o.source, displayValue: renderValue(o.value) }))
		.filter((o) => o.displayValue !== null && o.displayValue !== "");
	if (relevantOverrides.length === 0) return null;

	const wrapper = document.createElement("span");

	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = "storylens-show-more-btn";
	btn.textContent = tt("showMore");
	btn.dataset.open = "false";

	const detail = document.createElement("div");
	detail.className = "storylens-show-more-detail";
	detail.style.display = "none";

	for (const o of relevantOverrides) {
		const row = document.createElement("div");
		row.className = "storylens-override-row";
		const sourceLabel = document.createElement("span");
		sourceLabel.className = "storylens-override-source";
		sourceLabel.textContent =
			o.source === "alias"
				? tt("alias")
				: o.source === "version"
					? tt("version")
					: tt("keyword");
		const colon = document.createTextNode(": ");
		const val = document.createElement("span");
		val.textContent = o.displayValue;
		row.append(sourceLabel, colon, val);
		detail.append(row);
	}

	btn.addEventListener("click", (e) => {
		e.stopPropagation();
		const isOpen = btn.dataset.open === "true";
		btn.dataset.open = isOpen ? "false" : "true";
		detail.style.display = isOpen ? "none" : "block";
		onToggle();
	});

	wrapper.append(btn, detail);
	return wrapper;
}

// A field row: label block + optional show-more, all in one container.
function buildInfoFieldBlock(
	mainContent: HTMLElement,
	showMoreEl: HTMLElement | null,
): HTMLElement {
	const block = document.createElement("div");
	block.className = "storylens-info-field-block";
	const mainRow = document.createElement("div");
	mainRow.className = "storylens-info-field-main";
	mainRow.append(mainContent);
	if (showMoreEl) mainRow.append(showMoreEl);
	block.append(mainRow);
	return block;
}

function buildInfoPanel(
	data: AnchorData,
	onLayoutChange: () => void,
): HTMLElement {
	const panel = document.createElement("div");
	const info = resolveTooltipInfo(
		data.raw,
		data.alias,
		data.currentChapter,
		data.language,
	);
	const rawName = nameIn(data.raw, data.language);
	const base = pickBaseVersion(data.raw.versions);
	const active = pickActiveVersion(data.raw.versions, data.currentChapter);
	if (!data.alias && active && active.id !== base?.id) {
		const range = document.createElement("div");
		range.className = "storylens-info-version";
		range.textContent =
			tt("version") +
			" · ch." +
			active.startingChapter +
			(active.endingChapter == null ? "+" : `–${active.endingChapter}`);
		panel.append(range);
	}

	// Resolved image with provenance show-more
	if (info.image.value?.url) {
		const imageWrapper = document.createElement("div");
		imageWrapper.className = "storylens-image-wrapper";

		const image = document.createElement("img");
		image.className = "storylens-keyword-image";
		image.src = info.image.value.url;
		image.alt = rawName;
		image.loading = "lazy";
		// The image sizes the tooltip once it loads; keep it clear of the word.
		image.addEventListener("load", onLayoutChange);
		imageWrapper.append(buildImageButton(image));

		if (info.image.source !== "keyword" && info.image.overrides.length > 0) {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "storylens-show-more-btn";
			btn.textContent = tt("showMore");
			btn.dataset.open = "false";

			const detail = document.createElement("div");
			detail.className = "storylens-show-more-detail";
			detail.style.display = "none";

			// Show every override entry — including those without an image (displayed as "—").
			for (const o of info.image.overrides) {
				const row = document.createElement("div");
				row.className = "storylens-override-row storylens-image-override-row";
				const sourceLabel = document.createElement("span");
				sourceLabel.className = "storylens-override-source";
				sourceLabel.textContent =
					o.source === "alias"
						? tt("alias")
						: o.source === "version"
							? tt("version")
							: tt("keyword");
				if (o.value?.url) {
					const thumb = document.createElement("img");
					thumb.className = "storylens-show-more-thumb";
					thumb.src = o.value.url;
					thumb.alt = sourceLabel.textContent;
					thumb.loading = "lazy";
					row.append(sourceLabel, buildImageButton(thumb));
				} else {
					const placeholder = document.createElement("span");
					placeholder.textContent = tt("noImage");
					placeholder.style.opacity = "0.5";
					row.append(sourceLabel, placeholder);
				}
				detail.append(row);
			}

			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				const isOpen = btn.dataset.open === "true";
				btn.dataset.open = isOpen ? "false" : "true";
				detail.style.display = isOpen ? "none" : "block";
				onLayoutChange();
			});

			imageWrapper.append(btn, detail);
		}

		panel.append(imageWrapper);
	}

	// Name
	const nameEl = document.createElement("strong");
	nameEl.textContent = info.name.value ?? rawName;
	const nameShowMore =
		info.name.source !== "keyword"
			? buildShowMoreToggle(info.name, (v) => v, onLayoutChange)
			: null;
	panel.append(buildInfoFieldBlock(nameEl, nameShowMore));

	// Description (only if value exists)
	if (info.description.value) {
		const descEl = document.createElement("p");
		descEl.textContent = info.description.value;
		const descShowMore =
			info.description.source !== "keyword"
				? buildShowMoreToggle(info.description, (v) => v, onLayoutChange)
				: null;
		panel.append(buildInfoFieldBlock(descEl, descShowMore));
	}

	// Meta: category + nature
	const meta = document.createElement("div");
	meta.className = "storylens-keyword-meta";

	if (info.category.value) {
		const catEl = document.createElement("span");
		catEl.className = "storylens-category";
		catEl.textContent = getLocalizedName(info.category.value);
		catEl.style.setProperty("color", info.category.value.color, "important");
		const catShowMore =
			info.category.source !== "keyword"
				? buildShowMoreToggle(
						info.category as FieldInfo<EnrichedCategory>,
						(v) => (v ? getLocalizedName(v) : null),
						onLayoutChange,
					)
				: null;
		const catBlock = document.createElement("span");
		catBlock.append(catEl);
		if (catShowMore) catBlock.append(catShowMore);
		meta.append(catBlock);
	}

	if (info.nature.value) {
		const natEl = document.createElement("span");
		natEl.className = "storylens-nature";
		natEl.textContent = getLocalizedName(info.nature.value);
		natEl.style.setProperty("color", info.nature.value.color, "important");
		const natShowMore =
			info.nature.source !== "keyword"
				? buildShowMoreToggle(
						info.nature as FieldInfo<EnrichedNature>,
						(v) => (v ? getLocalizedName(v) : null),
						onLayoutChange,
					)
				: null;
		const natBlock = document.createElement("span");
		natBlock.append(natEl);
		if (natShowMore) natBlock.append(natShowMore);
		meta.append(natBlock);
	}

	if (meta.children.length > 0) panel.append(meta);

	return panel;
}

function buildAliasesPanel(
	raw: RawKeyword,
	language: Language,
	currentChapter: number,
): HTMLElement {
	const panel = document.createElement("div");
	const base = pickBaseVersion(raw.versions);
	// What an alias without its own image shows, so no row stays blank.
	const fallbackImage = resolveKeywordImage(raw, currentChapter);

	for (const alias of raw.aliases) {
		const item = document.createElement("div");
		item.className = "storylens-panel-item";
		// The row's details sit beside its thumbnail.
		const body = document.createElement("div");
		body.className = "storylens-panel-item-body";

		// Name row with optional override badge
		const nameRow = document.createElement("div");
		nameRow.className = "storylens-panel-item-name";
		const nameText = document.createElement("span");
		nameText.textContent = aliasDisplayName(alias, language);
		nameRow.append(nameText);
		if (alias.overrideStyle) {
			const badge = document.createElement("span");
			badge.className = "storylens-override-badge";
			badge.textContent = "override";
			nameRow.append(badge);
		}
		if (alias.imageId ?? alias.image?.url) {
			const imgBadge = document.createElement("span");
			imgBadge.className = "storylens-override-badge";
			imgBadge.textContent = "img";
			nameRow.append(imgBadge);
		}
		const editBtn = buildEditButton(
			{
				kind: "alias",
				id: alias.id,
				keywordId: raw.id,
				novelId: raw.novelId,
			},
			canEditAlias(currentUser, alias, raw),
		);
		if (editBtn) nameRow.append(editBtn);
		body.append(nameRow);

		// Category / Nature
		const ownCat = alias.category as EnrichedCategory | null;
		const ownNat = alias.nature as EnrichedNature | null;
		const inheritedCat = base?.category as EnrichedCategory | null | undefined;
		const inheritedNat = base?.nature as EnrichedNature | null | undefined;
		const displayCat = ownCat ?? inheritedCat ?? null;
		const displayNat = ownNat ?? inheritedNat ?? null;

		if (displayCat || displayNat) {
			const metaRow = document.createElement("div");
			metaRow.className = "storylens-panel-item-meta";
			if (displayCat) {
				const catEl = document.createElement("span");
				catEl.textContent = getLocalizedName(displayCat);
				catEl.style.setProperty(
					"color",
					!ownCat ? "inherit" : displayCat.color,
					"important",
				);
				if (!ownCat) catEl.className = "storylens-inherited";
				metaRow.append(catEl);
			}
			if (displayNat) {
				const natEl = document.createElement("span");
				natEl.textContent = getLocalizedName(displayNat);
				natEl.style.setProperty(
					"color",
					!ownNat ? "inherit" : displayNat.color,
					"important",
				);
				if (!ownNat) natEl.className = "storylens-inherited";
				metaRow.append(natEl);
			}
			body.append(metaRow);
		}

		// Description
		const ownDesc = alias.description ?? null;
		const displayDesc = ownDesc ?? base?.description ?? null;
		const isInherited = !ownDesc && !!displayDesc;
		if (displayDesc) {
			const descEl = document.createElement("div");
			descEl.className =
				"storylens-panel-item-desc" +
				(isInherited ? " storylens-inherited" : "");
			descEl.textContent = displayDesc;
			body.append(descEl);
		}

		// The alias's own image, else the keyword's, so every row shows one.
		const ownImage = alias.image?.url ? alias.image : null;
		const thumb = buildRowThumb(
			ownImage ?? fallbackImage,
			aliasDisplayName(alias, language),
			!ownImage,
		);
		if (thumb) {
			item.classList.add("storylens-panel-item--with-thumb");
			item.append(thumb);
		}
		item.append(body);
		panel.append(item);
	}

	return panel;
}

function buildVersionsPanel(
	raw: RawKeyword,
	currentChapter: number,
): HTMLElement {
	const panel = document.createElement("div");
	const sortedVersions = [...raw.versions].sort(
		(a, b) => Number(a.startingChapter) - Number(b.startingChapter),
	);
	const base = sortedVersions[0];
	// What a version without its own image shows, so no row stays blank.
	const fallbackImage = resolveKeywordImage(raw, currentChapter);

	for (const version of sortedVersions) {
		const item = document.createElement("div");
		item.className = "storylens-panel-item";
		// The row's details sit beside its thumbnail.
		const body = document.createElement("div");
		body.className = "storylens-panel-item-body";
		const isBase = version.id === base?.id;

		// Chapter range label
		const start = Number(version.startingChapter);
		const end = version.endingChapter;
		const label =
			end !== null && end !== undefined
				? `ch.${start}–${Number(end)}`
				: `ch.${start}+`;
		const labelEl = document.createElement("div");
		labelEl.className = "storylens-panel-item-name";
		const labelSpan = document.createElement("span");
		labelSpan.textContent = label;
		labelEl.append(labelSpan);
		if (version.imageId ?? version.image?.url) {
			const imgBadge = document.createElement("span");
			imgBadge.className = "storylens-override-badge";
			imgBadge.textContent = "img";
			labelEl.append(imgBadge);
		}
		const editBtn = buildEditButton(
			{
				kind: "version",
				id: version.id,
				keywordId: raw.id,
				novelId: raw.novelId,
			},
			canEditVersion(currentUser, version, raw),
		);
		if (editBtn) labelEl.append(editBtn);
		body.append(labelEl);

		// Category / Nature (own + inherited from base if not base)
		const ownCat = version.category as EnrichedCategory | null;
		const ownNat = version.nature as EnrichedNature | null;
		const inheritedCat = (!isBase ? base?.category : null) as
			| EnrichedCategory
			| null
			| undefined;
		const inheritedNat = (!isBase ? base?.nature : null) as
			| EnrichedNature
			| null
			| undefined;
		const displayCat = ownCat ?? inheritedCat ?? null;
		const displayNat = ownNat ?? inheritedNat ?? null;

		if (displayCat || displayNat) {
			const metaRow = document.createElement("div");
			metaRow.className = "storylens-panel-item-meta";
			if (displayCat) {
				const catEl = document.createElement("span");
				catEl.textContent = getLocalizedName(displayCat);
				catEl.style.setProperty(
					"color",
					!ownCat ? "inherit" : displayCat.color,
					"important",
				);
				if (!ownCat) catEl.className = "storylens-inherited";
				metaRow.append(catEl);
			}
			if (displayNat) {
				const natEl = document.createElement("span");
				natEl.textContent = getLocalizedName(displayNat);
				natEl.style.setProperty(
					"color",
					!ownNat ? "inherit" : displayNat.color,
					"important",
				);
				if (!ownNat) natEl.className = "storylens-inherited";
				metaRow.append(natEl);
			}
			body.append(metaRow);
		}

		// Description (own + inherited from base)
		const ownDesc = version.description ?? null;
		const inheritedDesc =
			!ownDesc && !isBase ? (base?.description ?? null) : null;
		const displayDesc = ownDesc ?? inheritedDesc;
		const isInherited = !ownDesc && !!inheritedDesc;
		if (displayDesc) {
			const descEl = document.createElement("div");
			descEl.className =
				"storylens-panel-item-desc" +
				(isInherited ? " storylens-inherited" : "");
			descEl.textContent = displayDesc;
			body.append(descEl);
		}

		// The version's own image, else the keyword's, so every row shows one.
		const ownImage = version.image?.url ? version.image : null;
		const thumb = buildRowThumb(ownImage ?? fallbackImage, label, !ownImage);
		if (thumb) {
			item.classList.add("storylens-panel-item--with-thumb");
			item.append(thumb);
		}
		item.append(body);
		panel.append(item);
	}

	return panel;
}

type TabDef = { label: string; content: HTMLElement };

function buildTabSystem(
	tabs: TabDef[],
	content: HTMLElement,
	onLayoutChange: () => void,
): HTMLElement {
	const tabBar = document.createElement("div");
	tabBar.className = "storylens-tab-bar";
	tabBar.setAttribute("role", "tablist");
	tabBar.setAttribute("aria-label", tt("info"));

	const tabId = ++tabSequence;
	const panels: HTMLElement[] = [];
	const buttons: HTMLButtonElement[] = [];

	for (let i = 0; i < tabs.length; i++) {
		const tab = tabs[i];

		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = `storylens-tab-btn${i === 0 ? " storylens-tab-btn--active" : ""}`;
		btn.textContent = tab.label;
		btn.id = `storylens-tab-${tabId}-${i}`;
		btn.setAttribute("aria-controls", `storylens-panel-${tabId}-${i}`);
		btn.setAttribute("role", "tab");
		btn.setAttribute("aria-selected", String(i === 0));
		btn.tabIndex = i === 0 ? 0 : -1;
		tabBar.append(btn);
		buttons.push(btn);

		const panel = document.createElement("div");
		panel.className = "storylens-tab-panel";
		panel.id = `storylens-panel-${tabId}-${i}`;
		panel.setAttribute("aria-labelledby", btn.id);
		panel.setAttribute("role", "tabpanel");
		panel.setAttribute("aria-label", tab.label);
		panel.style.display = i === 0 ? "block" : "none";
		panel.append(tab.content);
		panels.push(panel);

		btn.addEventListener("keydown", (event) => {
			let next: number;
			const direction = getLocale() === "ar" ? -1 : 1;
			if (event.key === "ArrowRight")
				next = (i + direction + tabs.length) % tabs.length;
			else if (event.key === "ArrowLeft")
				next = (i - direction + tabs.length) % tabs.length;
			else if (event.key === "Home") next = 0;
			else if (event.key === "End") next = tabs.length - 1;
			else return;
			event.preventDefault();
			buttons[next].click();
			buttons[next].focus();
		});
		btn.addEventListener("click", () => {
			for (let j = 0; j < tabs.length; j++) {
				buttons[j].classList.toggle("storylens-tab-btn--active", j === i);
				buttons[j].setAttribute("aria-selected", String(j === i));
				buttons[j].tabIndex = j === i ? 0 : -1;
				panels[j].style.display = j === i ? "block" : "none";
			}
			onLayoutChange();
		});
	}

	for (const panel of panels) content.append(panel);
	return tabBar;
}

function buildKeywordTooltipContent(
	data: AnchorData,
	onLayoutChange: () => void,
): HTMLElement {
	const tooltip = document.createElement("div");
	tooltip.className =
		"storylens-tooltip-text storylens-keyword-info storylens-tooltip-text--floating";
	tooltip.setAttribute("role", "tooltip");
	tooltip.dir = getLocale() === "ar" ? "rtl" : "ltr";
	// Scroll the content independently so the tooltip's arrow stays visible.
	const content = document.createElement("div");
	content.className = "storylens-tooltip-content";
	tooltip.append(content);

	const tabs: TabDef[] = [
		{
			label: tt("info"),
			content: buildInfoPanel(data, onLayoutChange),
		},
	];

	const base = pickBaseVersion(data.raw.versions);
	const active = pickActiveVersion(data.raw.versions, data.currentChapter);
	if (base && (data.alias || active?.id !== base.id)) {
		tabs.push({
			label: tt("original"),
			content: buildInfoPanel(
				{
					...data,
					raw: { ...data.raw, versions: [base] },
					alias: null,
					currentChapter: Number(base.startingChapter),
				},
				onLayoutChange,
			),
		});
	}

	if (data.raw.aliases.length > 0) {
		tabs.push({
			label: tt("aliases"),
			content: buildAliasesPanel(data.raw, data.language, data.currentChapter),
		});
	}

	if (data.raw.versions.length > 1) {
		tabs.push({
			label: tt("versions"),
			content: buildVersionsPanel(data.raw, data.currentChapter),
		});
	}

	if (tabs.length === 1) {
		// No tabs needed — just show the info panel directly
		content.append(tabs[0].content);
	} else {
		tooltip.append(buildTabSystem(tabs, content, onLayoutChange));
	}

	return tooltip;
}

/** Centers a floating box on the word, kept inside the viewport. */
function centerOnAnchor(anchorRect: DOMRect, box: HTMLElement): number {
	const width = box.getBoundingClientRect().width;
	const left = anchorRect.left + anchorRect.width / 2 - width / 2;
	return Math.max(
		TOOLTIP_GAP_PX,
		Math.min(left, window.innerWidth - width - TOOLTIP_GAP_PX),
	);
}

/** Keeps tooltip, Edit and Generate image together, clear of the word and viewport edges. */
function positionTooltip(anchor: HTMLElement, tooltip: HTMLElement): void {
	const anchorRect = anchor.getBoundingClientRect();
	const content = tooltip.firstElementChild;
	const scrollTop = content?.scrollTop ?? 0;
	// Measure unconstrained content again after tab, image, font or viewport changes.
	tooltip.style.maxHeight = "none";
	const tooltipRect = tooltip.getBoundingClientRect();
	const viewportPadding = TOOLTIP_GAP_PX;
	const aboveEnd = Math.min(
		anchorRect.top - TOOLTIP_GAP_PX,
		window.innerHeight - viewportPadding,
	);
	const belowStart = Math.max(
		anchorRect.bottom + TOOLTIP_GAP_PX,
		viewportPadding,
	);
	const above = Math.max(0, aboveEnd - viewportPadding);
	const below = Math.max(0, window.innerHeight - viewportPadding - belowStart);
	if (activeActions) {
		const tabsHeight =
			tooltip.querySelector(".storylens-tab-bar")?.getBoundingClientRect()
				.height ?? 0;
		activeActions.style.maxHeight =
			Math.max(40, Math.max(above, below) - Math.max(64, tabsHeight + 48)) +
			"px";
	}
	const actionsHeight = activeActions?.getBoundingClientRect().height ?? 0;
	const reserve = activeActions ? actionsHeight + TOOLTIP_GAP_PX : 0;
	const aboveCapacity = Math.max(0, above - reserve);
	const belowCapacity = Math.max(0, below - reserve);
	const placement =
		tooltipRect.height <= aboveCapacity
			? "above"
			: tooltipRect.height <= belowCapacity
				? "below"
				: aboveCapacity >= belowCapacity
					? "above"
					: "below";
	const capacity = placement === "above" ? aboveCapacity : belowCapacity;
	tooltip.style.maxHeight = `${Math.max(0, capacity)}px`;
	const height = tooltip.getBoundingClientRect().height;
	if (content) content.scrollTop = scrollTop;
	const top =
		placement === "above" ? aboveEnd - reserve - height : belowStart + reserve;

	tooltip.style.top = `${top}px`;
	tooltip.style.left = `${centerOnAnchor(anchorRect, tooltip)}px`;
	tooltip.dataset.placement = placement;

	if (!activeActions) return;
	const actionsTop =
		placement === "above" ? top + height + TOOLTIP_GAP_PX : belowStart;
	activeActions.style.top = `${actionsTop}px`;
	activeActions.style.left = `${centerOnAnchor(anchorRect, activeActions)}px`;
}

/**
 * Actions attached to the tooltip: edits and parent-scoped creation,
 * gated by their own creation or editing permissions.
 */
function buildHoverActions(data: AnchorData): HTMLElement | null {
	if (
		!actions ||
		(!actions.onEdit &&
			!actions.onGenerateImage &&
			!actions.onCreate &&
			!actions.onPick)
	)
		return null;
	const editable = canEditKeyword(currentUser, data.raw);
	const creatable = canCreate(currentUser);
	if (!editable && !creatable) return null;

	const bar = document.createElement("div");
	bar.className = "storylens-keyword-hover-actions";
	bar.dir = getLocale() === "ar" ? "rtl" : "ltr";
	const target: TooltipEditTarget = {
		kind: "keyword",
		id: data.raw.id,
		keywordId: data.raw.id,
		novelId: data.raw.novelId,
	};
	const edit = buildEditButton(target, editable);
	if (edit) bar.append(edit);
	if (actions.onGenerateImage && editable) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "storylens-edit-btn storylens-generate-image-btn";
		btn.dataset.hoverAction = "generate-image";
		btn.title = tt("generateImage");
		btn.append(
			createElement(ImagePlus, {
				width: 12,
				height: 12,
				"aria-hidden": "true",
				"stroke-width": 1.75,
			}),
			document.createTextNode(tt("generateImage")),
		);
		btn.addEventListener("click", (event) => {
			event.stopPropagation();

			hideActiveTooltip();
			actions?.onGenerateImage?.(target);
		});

		bar.append(btn);
	}
	const createTarget: TooltipCreateTarget = {
		keywordId: data.raw.id,
		novelId: data.raw.novelId,
		keywordName: nameIn(data.raw, data.language),
		language: data.language,
	};
	const makeAction = (
		label: string,
		action: string,
		icon: typeof Plus,
		run: () => void,
		iconOnly = false,
	) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "storylens-edit-btn";
		button.dataset.hoverAction = action;
		button.setAttribute("aria-label", tt(label));
		button.title = tt(label);
		button.append(
			createElement(icon, {
				width: 12,
				height: 12,
				"aria-hidden": "true",
				"stroke-width": 1.75,
			}),
		);
		if (!iconOnly) button.append(document.createTextNode(tt(label)));
		button.addEventListener("click", (event) => {
			event.stopPropagation();
			// Page scripts may synthesize clicks on shared DOM; direct saves need a real gesture.
			if (
				(action === "add-replacement" || action === "pick-replacement") &&
				!event.isTrusted
			)
				return;
			hideActiveTooltip();
			run();
		});
		return button;
	};
	if (creatable && actions.onCreate) {
		const aliasRow = document.createElement("div");
		aliasRow.className = "storylens-tooltip-action-row";
		aliasRow.append(
			makeAction("addAlias", "add-alias", Plus, () =>
				actions?.onCreate?.("alias", createTarget),
			),
		);
		if (actions.onPick)
			aliasRow.append(
				makeAction(
					"pickAlias",
					"pick-alias",
					Sparkles,
					() => actions?.onPick?.("alias", createTarget),
					true,
				),
			);
		bar.append(aliasRow);
		bar.append(
			makeAction("addVersion", "add-version", Plus, () =>
				actions?.onCreate?.("version", createTarget),
			),
		);
	}
	if (creatable && actions.onPick && createTarget.keywordName.trim()) {
		const replacementRow = document.createElement("div");
		replacementRow.className = "storylens-tooltip-action-row";
		replacementRow.append(
			makeAction("addReplacement", "add-replacement", Plus, () =>
				actions?.onPick?.("replacement", createTarget),
			),
			makeAction(
				"pickReplacement",
				"pick-replacement",
				Sparkles,
				() => actions?.onPick?.("replacement", createTarget),
				true,
			),
		);
		bar.append(replacementRow);
	}
	return bar.childElementCount ? bar : null;
}

function clearHideTimeout(): void {
	if (hideTimeout) {
		clearTimeout(hideTimeout);
		hideTimeout = null;
	}
}

function hideActiveTooltip(): void {
	clearHideTimeout();
	activeAnchor?.setAttribute("aria-expanded", "false");
	activeTooltip?.remove();
	activeTooltip = null;
	activeActions?.remove();
	activeActions = null;
	activeAnchor = null;
}

function scheduleHideTooltip(): void {
	if (tooltipTrigger !== "hover") return;
	clearHideTimeout();
	hideTimeout = setTimeout(() => {
		hideActiveTooltip();
	}, HIDE_DELAY_MS);
}

function showTooltip(anchor: HTMLElement): void {
	if (pickingText) return;
	const data = anchorDataMap.get(anchor);
	if (!data) {
		return;
	}

	clearHideTimeout();
	applyAppearanceToRoot(getTooltipRoot());

	if (activeAnchor === anchor && activeTooltip) {
		positionTooltip(anchor, activeTooltip);
		return;
	}

	hideActiveTooltip();
	activeAnchor = anchor;
	anchor.setAttribute("aria-expanded", "true");

	const tooltip = buildKeywordTooltipContent(data, () => {
		if (activeAnchor && activeTooltip) {
			positionTooltip(activeAnchor, activeTooltip);
		}
	});
	tooltip.addEventListener("mouseenter", clearHideTimeout);
	tooltip.addEventListener("mouseleave", scheduleHideTooltip);

	const root = getTooltipRoot();
	root.append(tooltip);
	activeTooltip = tooltip;

	// A separate action box keeps the controls outside the scrolling tooltip.
	const hoverActions = buildHoverActions(data);
	if (hoverActions) {
		hoverActions.addEventListener("mouseenter", clearHideTimeout);
		hoverActions.addEventListener("mouseleave", scheduleHideTooltip);
		root.append(hoverActions);
		activeActions = hoverActions;
	}

	positionTooltip(anchor, tooltip);
}

function handleReposition(event?: Event): void {
	// Scrolling the constrained content must not remeasure and reset its scroll.
	if (
		event?.type === "scroll" &&
		event.target instanceof Node &&
		(activeTooltip?.contains(event.target) ||
			activeActions?.contains(event.target))
	)
		return;
	if (activeAnchor && activeTooltip) {
		positionTooltip(activeAnchor, activeTooltip);
	}
}

function attachScrollListener(): void {
	if (scrollListenerAttached) {
		return;
	}

	window.addEventListener("scroll", handleReposition, true);
	window.addEventListener("resize", handleReposition);
	scrollListenerAttached = true;
}

function detachScrollListener(): void {
	if (!scrollListenerAttached) {
		return;
	}

	window.removeEventListener("scroll", handleReposition, true);
	window.removeEventListener("resize", handleReposition);
	scrollListenerAttached = false;
}

export function registerKeywordTooltipAnchor(
	anchor: HTMLElement,
	enriched: EnrichedKeyword,
	raw: RawKeyword,
	alias: RawKeywordAlias | null,
	currentChapter: number,
	language: Language,
): void {
	anchorDataMap.set(anchor, { enriched, raw, alias, currentChapter, language });
	anchor.tabIndex = 0;
	anchor.setAttribute("role", "button");
	anchor.setAttribute("aria-expanded", "false");

	anchor.addEventListener("mouseenter", () => {
		if (tooltipTrigger === "hover") showTooltip(anchor);
	});

	anchor.addEventListener("click", () => {
		if (pickingText || tooltipTrigger !== "click") return;
		if (activeAnchor === anchor && activeTooltip) hideActiveTooltip();
		else showTooltip(anchor);
	});

	anchor.addEventListener("mouseleave", (event) => {
		const related = event.relatedTarget;
		if (
			related instanceof Node &&
			(activeTooltip?.contains(related) || activeActions?.contains(related))
		) {
			return;
		}

		scheduleHideTooltip();
	});

	anchor.addEventListener("keydown", (event) => {
		if (pickingText || (event.key !== "Enter" && event.key !== " ")) return;
		event.preventDefault();
		if (activeAnchor === anchor && activeTooltip) hideActiveTooltip();
		else showTooltip(anchor);
	});
}

function handleOutsideClick(event: MouseEvent): void {
	if (!activeTooltip) return;
	const path = event.composedPath();
	if (
		(activeAnchor && path.includes(activeAnchor)) ||
		path.includes(activeTooltip) ||
		(activeActions && path.includes(activeActions))
	)
		return;
	hideActiveTooltip();
}

function handleEscape(event: KeyboardEvent): void {
	if (event.key === "Escape") hideActiveTooltip();
}

export function initKeywordTooltipPortal(): void {
	if (portalInitialized) {
		return;
	}

	applyAppearanceToRoot(getTooltipRoot());
	attachScrollListener();
	document.addEventListener("click", handleOutsideClick, true);
	document.addEventListener("keydown", handleEscape);
	portalInitialized = true;
}

export function destroyKeywordTooltipPortal(): void {
	clearHideTimeout();
	hideActiveTooltip();
	closeImageModal();
	document.getElementById(TOOLTIP_ROOT_ID)?.remove();
	detachScrollListener();
	document.removeEventListener("click", handleOutsideClick, true);
	document.removeEventListener("keydown", handleEscape);
	portalInitialized = false;
}
