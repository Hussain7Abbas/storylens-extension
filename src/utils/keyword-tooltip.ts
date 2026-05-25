import type { GetKeywords200DataItem } from "@/api/generated/schemas";

const TOOLTIP_ROOT_ID = "storylens-keyword-tooltip-root";
const TOOLTIP_GAP_PX = 8;
const HIDE_DELAY_MS = 80;

const keywordByAnchor = new WeakMap<HTMLElement, GetKeywords200DataItem>();

let portalInitialized = false;
let activeAnchor: HTMLElement | null = null;
let activeTooltip: HTMLElement | null = null;
let hideTimeout: ReturnType<typeof setTimeout> | null = null;
let scrollListenerAttached = false;

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

function buildKeywordTooltipContent(
	keyword: GetKeywords200DataItem,
): HTMLElement {
	const tooltip = document.createElement("div");
	tooltip.className =
		"storylens-tooltip-text storylens-keyword-info storylens-tooltip-text--floating";
	tooltip.setAttribute("role", "tooltip");

	if (keyword.image?.url) {
		const image = document.createElement("img");
		image.className = "storylens-keyword-image";
		image.src = keyword.image.url;
		image.alt = keyword.name;
		image.loading = "lazy";
		tooltip.append(image);
	}

	const title = document.createElement("strong");
	title.textContent = keyword.name;
	tooltip.append(title);

	if (keyword.description) {
		const description = document.createElement("p");
		description.textContent = keyword.description;
		tooltip.append(description);
	}

	const meta = document.createElement("div");
	meta.className = "storylens-keyword-meta";

	const category = document.createElement("span");
	category.className = "storylens-category";
	category.textContent = keyword.category.name;
	category.style.setProperty("color", keyword.category.color, "important");
	meta.append(category);

	const nature = document.createElement("span");
	nature.className = "storylens-nature";
	nature.textContent = keyword.nature.name;
	nature.style.setProperty("color", keyword.nature.color, "important");
	meta.append(nature);

	tooltip.append(meta);
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

	let left =
		anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2;
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
	const keyword = keywordByAnchor.get(anchor);
	if (!keyword) {
		return;
	}

	clearHideTimeout();

	if (activeAnchor === anchor && activeTooltip) {
		positionTooltip(anchor, activeTooltip);
		return;
	}

	hideActiveTooltip();
	activeAnchor = anchor;

	const tooltip = buildKeywordTooltipContent(keyword);
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
	keyword: GetKeywords200DataItem,
): void {
	keywordByAnchor.set(anchor, keyword);

	anchor.addEventListener("mouseenter", () => {
		showTooltip(anchor);
	});

	anchor.addEventListener("mouseleave", (event) => {
		const related = event.relatedTarget;
		if (
			related instanceof Node &&
			activeTooltip?.contains(related)
		) {
			return;
		}

		scheduleHideTooltip();
	});
}

export function initKeywordTooltipPortal(): void {
	if (portalInitialized) {
		return;
	}

	getTooltipRoot();
	attachScrollListener();
	portalInitialized = true;
}

export function destroyKeywordTooltipPortal(): void {
	clearHideTimeout();
	hideActiveTooltip();
	document.getElementById(TOOLTIP_ROOT_ID)?.remove();
	detachScrollListener();
	portalInitialized = false;
}
