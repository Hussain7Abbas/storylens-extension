import { createElement, Pencil } from "lucide";
import type { AuthUser } from "@/lib/auth/auth-store";
import {
	canEditAlias,
	canEditKeyword,
	canEditVersion,
} from "@/lib/auth/permissions";
import { parseFontSize } from "@/lib/font-size";
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
	pickBaseVersion,
	resolveKeywordInfo,
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
let activeAnchor: HTMLElement | null = null;
let activeTooltip: HTMLElement | null = null;
let hideTimeout: ReturnType<typeof setTimeout> | null = null;
let scrollListenerAttached = false;

const TOOLTIP_STRINGS: Record<string, Record<string, string>> = {
	en: {
		info: "Info",
		aliases: "Aliases",
		versions: "Versions",
		version: "Version",
		keyword: "Keyword",
		alias: "Alias",
		showMore: "↗",
		noImage: "—",
		edit: "Edit",
		viewImage: "View full image",
		close: "Close",
	},
	ar: {
		info: "معلومات",
		aliases: "الأسماء البديلة",
		versions: "النسخ",
		version: "النسخة",
		keyword: "الكلمة",
		alias: "الاسم البديل",
		showMore: "↗",
		noImage: "—",
		edit: "تعديل",
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

type TooltipActions = {
	/** Opens the entry's form; Edit buttons appear only while this is set. */
	onEdit?: (target: TooltipEditTarget) => void;
	onImageOpen?: () => void;
};

let actions: TooltipActions | null = null;
let currentUser: AuthUser | null = null;

export function setTooltipActions(next: TooltipActions | null): void {
	actions = next;
}

/** The signed-in reader, for the per-row edit rules. */
export function setTooltipUser(user: AuthUser | null): void {
	currentUser = user;
}

let cachedFontFace: string | null = null;
let cachedFontSize: number | null = null;

export function setTooltipFontFace(fontFace: string | null): void {
	cachedFontFace = fontFace;
	if (activeTooltip) applyAppearanceToRoot(getTooltipRoot());
}

export function setTooltipFontSize(fontSize: number | null): void {
	cachedFontSize = fontSize === null ? null : parseFontSize(fontSize);
	if (activeTooltip) applyAppearanceToRoot(getTooltipRoot());
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
	const info = resolveKeywordInfo(
		data.raw,
		data.alias,
		data.currentChapter,
		data.language,
	);
	const rawName = nameIn(data.raw, data.language);

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

	const editBtn = buildEditButton(
		{
			kind: "keyword",
			id: data.raw.id,
			keywordId: data.raw.id,
			novelId: data.raw.novelId,
		},
		canEditKeyword(currentUser, data.raw),
	);
	if (editBtn) {
		const actionsRow = document.createElement("div");
		actionsRow.className = "storylens-keyword-actions";
		actionsRow.append(editBtn);
		panel.append(actionsRow);
	}

	return panel;
}

function buildAliasesPanel(raw: RawKeyword, language: Language): HTMLElement {
	const panel = document.createElement("div");
	const base = pickBaseVersion(raw.versions);

	for (const alias of raw.aliases) {
		const item = document.createElement("div");
		item.className = "storylens-panel-item";

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
		item.append(nameRow);

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
			item.append(metaRow);
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
			item.append(descEl);
		}

		panel.append(item);
	}

	return panel;
}

function buildVersionsPanel(raw: RawKeyword): HTMLElement {
	const panel = document.createElement("div");
	const sortedVersions = [...raw.versions].sort(
		(a, b) => Number(a.startingChapter) - Number(b.startingChapter),
	);
	const base = sortedVersions[0];

	for (const version of sortedVersions) {
		const item = document.createElement("div");
		item.className = "storylens-panel-item";
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
		item.append(labelEl);

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
			item.append(metaRow);
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
			item.append(descEl);
		}

		panel.append(item);
	}

	return panel;
}

type TabDef = { label: string; content: HTMLElement };

function buildTabSystem(
	tabs: TabDef[],
	onLayoutChange: () => void,
): HTMLElement {
	const wrapper = document.createElement("div");

	const tabBar = document.createElement("div");
	tabBar.className = "storylens-tab-bar";

	const panels: HTMLElement[] = [];
	const buttons: HTMLButtonElement[] = [];

	for (let i = 0; i < tabs.length; i++) {
		const tab = tabs[i];

		const btn = document.createElement("button");
		btn.type = "button";
		btn.className =
			"storylens-tab-btn" + (i === 0 ? " storylens-tab-btn--active" : "");
		btn.textContent = tab.label;
		tabBar.append(btn);
		buttons.push(btn);

		const panel = document.createElement("div");
		panel.className = "storylens-tab-panel";
		panel.style.display = i === 0 ? "block" : "none";
		panel.append(tab.content);
		panels.push(panel);

		btn.addEventListener("click", () => {
			for (let j = 0; j < tabs.length; j++) {
				buttons[j].classList.toggle("storylens-tab-btn--active", j === i);
				panels[j].style.display = j === i ? "block" : "none";
			}
			onLayoutChange();
		});
	}

	wrapper.append(tabBar);
	for (const panel of panels) wrapper.append(panel);
	return wrapper;
}

function buildKeywordTooltipContent(
	data: AnchorData,
	onLayoutChange: () => void,
): HTMLElement {
	const tooltip = document.createElement("div");
	tooltip.className =
		"storylens-tooltip-text storylens-keyword-info storylens-tooltip-text--floating";
	tooltip.setAttribute("role", "tooltip");

	const tabs: TabDef[] = [
		{
			label: tt("info"),
			content: buildInfoPanel(data, onLayoutChange),
		},
	];

	if (data.raw.aliases.length > 0) {
		tabs.push({
			label: tt("aliases"),
			content: buildAliasesPanel(data.raw, data.language),
		});
	}

	if (data.raw.versions.length > 1) {
		tabs.push({
			label: tt("versions"),
			content: buildVersionsPanel(data.raw),
		});
	}

	if (tabs.length === 1) {
		// No tabs needed — just show the info panel directly
		tooltip.append(tabs[0].content);
	} else {
		tooltip.append(buildTabSystem(tabs, onLayoutChange));
	}

	return tooltip;
}

function positionTooltip(anchor: HTMLElement, tooltip: HTMLElement): void {
	const anchorRect = anchor.getBoundingClientRect();
	const tooltipRect = tooltip.getBoundingClientRect();
	const viewportPadding = TOOLTIP_GAP_PX;

	let placement: "above" | "below" = "above";
	let top = anchorRect.top - tooltipRect.height - TOOLTIP_GAP_PX;

	if (top < viewportPadding) {
		placement = "below";
		top = anchorRect.bottom + TOOLTIP_GAP_PX;
	}

	let left = anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2;
	left = Math.max(
		viewportPadding,
		Math.min(left, window.innerWidth - tooltipRect.width - viewportPadding),
	);

	tooltip.style.top = `${top}px`;
	tooltip.style.left = `${left}px`;
	tooltip.dataset.placement = placement;
}

function clearHideTimeout(): void {
	if (hideTimeout) {
		clearTimeout(hideTimeout);
		hideTimeout = null;
	}
}

function hideActiveTooltip(): void {
	clearHideTimeout();
	activeTooltip?.remove();
	activeTooltip = null;
	activeAnchor = null;
}

function scheduleHideTooltip(): void {
	clearHideTimeout();
	hideTimeout = setTimeout(() => {
		hideActiveTooltip();
	}, HIDE_DELAY_MS);
}

function showTooltip(anchor: HTMLElement): void {
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

	const tooltip = buildKeywordTooltipContent(data, () => {
		if (activeAnchor && activeTooltip) {
			positionTooltip(activeAnchor, activeTooltip);
		}
	});
	tooltip.addEventListener("mouseenter", clearHideTimeout);
	tooltip.addEventListener("mouseleave", scheduleHideTooltip);

	getTooltipRoot().append(tooltip);
	activeTooltip = tooltip;
	positionTooltip(anchor, tooltip);
}

function handleReposition(): void {
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

	anchor.addEventListener("mouseenter", () => {
		showTooltip(anchor);
	});

	anchor.addEventListener("mouseleave", (event) => {
		const related = event.relatedTarget;
		if (related instanceof Node && activeTooltip?.contains(related)) {
			return;
		}

		scheduleHideTooltip();
	});
}

export function initKeywordTooltipPortal(): void {
	if (portalInitialized) {
		return;
	}

	applyAppearanceToRoot(getTooltipRoot());
	attachScrollListener();
	portalInitialized = true;
}

export function destroyKeywordTooltipPortal(): void {
	clearHideTimeout();
	hideActiveTooltip();
	closeImageModal();
	document.getElementById(TOOLTIP_ROOT_ID)?.remove();
	detachScrollListener();
	portalInitialized = false;
}
