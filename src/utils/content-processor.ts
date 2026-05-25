import type { GetKeywords200DataItem } from "@/api/schemas";
import type {
	ContentProcessingStats,
	NovelContentData,
} from "@/types/content-data";

const LOG_PREFIX = "[StoryLens]";
const PROCESS_ATTR = "data-storylens-processed";

const CONTENT_ROOT_SELECTORS = [
	".chapter-content",
	'[class*="chapter-content"]',
	'[class*="chapter_content"]',
	'[class*="chapter-body"]',
	"article",
	"main",
];

const SKIP_ANCESTOR_SELECTOR =
	"script, style, noscript, textarea, input, select, option, [data-storylens-skip]";

const DEFAULT_MARKUP_SKIP_SELECTOR = ".storylens-keyword, .storylens-tooltip";

const REPLACEMENT_MARKUP_SKIP_SELECTOR =
	".storylens-replaced, .storylens-keyword, .storylens-tooltip";

type MatchingType = "FULL" | "PARTIAL";

type TermWithMatching = {
	term: string;
	matchingType: MatchingType;
};

function sortTermsByLengthDesc(terms: TermWithMatching[]): TermWithMatching[] {
	return [...terms].sort(
		(left, right) => right.term.length - left.term.length,
	);
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupeTermsCaseInsensitive(terms: TermWithMatching[]): TermWithMatching[] {
	const seen = new Set<string>();
	const deduped: TermWithMatching[] = [];

	for (const entry of sortTermsByLengthDesc(terms)) {
		const normalized = entry.term.toLowerCase();
		if (seen.has(normalized)) {
			continue;
		}

		seen.add(normalized);
		deduped.push(entry);
	}

	return deduped;
}

function wrapFullTermPattern(escaped: string): string {
	return `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`;
}

function buildCombinedPattern(terms: TermWithMatching[]): RegExp | undefined {
	const uniqueTerms = dedupeTermsCaseInsensitive(
		terms.filter((entry) => entry.term),
	);
	if (uniqueTerms.length === 0) {
		return undefined;
	}

	const pattern = uniqueTerms
		.map(({ term, matchingType }) => {
			const escaped = escapeRegex(term);
			return matchingType === "FULL" ? wrapFullTermPattern(escaped) : escaped;
		})
		.join("|");

	try {
		return new RegExp(pattern, "giu");
	} catch (error) {
		console.error(`${LOG_PREFIX} Failed to build keyword pattern`, error);
		return undefined;
	}
}

export function findContentRoot(): HTMLElement {
	for (const selector of CONTENT_ROOT_SELECTORS) {
		const element = document.querySelector(selector);
		if (element instanceof HTMLElement && element.textContent?.trim()) {
			console.log(`${LOG_PREFIX} Using content root`, selector);
			return element;
		}
	}

	console.log(`${LOG_PREFIX} Falling back to document.body as content root`);
	return document.body;
}

function collectTextNodes(
	root: HTMLElement,
	markupSkipSelector = DEFAULT_MARKUP_SKIP_SELECTOR,
): Text[] {
	const textNodes: Text[] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			const parent = node.parentElement;
			if (!parent) {
				return NodeFilter.FILTER_REJECT;
			}

			if (parent.closest(SKIP_ANCESTOR_SELECTOR)) {
				return NodeFilter.FILTER_REJECT;
			}

			if (parent.closest(markupSkipSelector)) {
				return NodeFilter.FILTER_REJECT;
			}

			if (!node.textContent?.trim()) {
				return NodeFilter.FILTER_REJECT;
			}

			return NodeFilter.FILTER_ACCEPT;
		},
	});

	let current = walker.nextNode();
	while (current) {
		if (current instanceof Text) {
			textNodes.push(current);
		}
		current = walker.nextNode();
	}

	return textNodes;
}

function processTextNodeMatches(
	textNode: Text,
	regex: RegExp,
	handler: (matchedText: string) => Node | null,
): number {
	const text = textNode.textContent ?? "";
	if (!text) {
		return 0;
	}

	const parent = textNode.parentNode;
	if (!parent) {
		return 0;
	}

	regex.lastIndex = 0;
	const fragment = document.createDocumentFragment();
	let lastIndex = 0;
	let match = regex.exec(text);
	let occurrences = 0;

	while (match) {
		const matchedText = match[0];
		const matchIndex = match.index;

		if (matchIndex > lastIndex) {
			fragment.appendChild(
				document.createTextNode(text.slice(lastIndex, matchIndex)),
			);
		}

		const replacementNode = handler(matchedText);
		if (replacementNode) {
			fragment.appendChild(replacementNode);
			occurrences += 1;
		} else {
			fragment.appendChild(document.createTextNode(matchedText));
		}

		lastIndex = matchIndex + matchedText.length;

		if (matchedText.length === 0) {
			regex.lastIndex += 1;
		}

		match = regex.exec(text);
	}

	if (occurrences === 0) {
		return 0;
	}

	if (lastIndex < text.length) {
		fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
	}

	parent.replaceChild(fragment, textNode);
	return occurrences;
}

function createReplacedElement(replacementText: string): HTMLSpanElement {
	const span = document.createElement("span");
	span.className = "storylens-replaced";
	span.append(document.createTextNode(replacementText));
	return span;
}

function createKeywordElement(
	matchedText: string,
	keyword: GetKeywords200DataItem,
): HTMLSpanElement {
	const span = document.createElement("span");
	span.className =
		"storylens-tooltip storylens-keyword-tooltip storylens-keyword";
	span.style.setProperty("color", keyword.category.color, "important");
	span.dataset.keywordId = keyword.id;

	const natureIndicator = document.createElement("span");
	natureIndicator.className = "storylens-nature-indicator";
	natureIndicator.style.setProperty(
		"background-color",
		keyword.nature.color,
		"important",
	);
	natureIndicator.setAttribute("aria-hidden", "true");
	span.append(natureIndicator);
	span.append(document.createTextNode(matchedText));

	const tooltip = document.createElement("span");
	tooltip.className = "storylens-tooltip-text storylens-keyword-info";

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
	span.append(tooltip);

	return span;
}

function buildReplacementLookup(
	replacements: NovelContentData["replacements"],
): Map<string, NovelContentData["replacements"][number]> {
	const lookup = new Map<string, NovelContentData["replacements"][number]>();

	for (const replacement of replacements) {
		if (!replacement.from) {
			continue;
		}

		const key = replacement.from.toLowerCase();
		if (!lookup.has(key)) {
			lookup.set(key, replacement);
		}
	}

	return lookup;
}

function buildKeywordLookup(
	keywords: NovelContentData["keywords"],
): Map<string, GetKeywords200DataItem> {
	const lookup = new Map<string, GetKeywords200DataItem>();
	const sortedKeywords = [...keywords].sort(
		(left, right) => right.name.length - left.name.length,
	);

	for (const keyword of sortedKeywords) {
		if (!keyword.name) {
			continue;
		}

		const key = keyword.name.toLowerCase();
		if (!lookup.has(key)) {
			lookup.set(key, keyword);
		}
	}

	return lookup;
}

function applyReplacements(
	root: HTMLElement,
	replacements: NovelContentData["replacements"],
): number {
	const regex = buildCombinedPattern(
		replacements.map((replacement) => ({
			term: replacement.from,
			matchingType: replacement.matchingType ?? "FULL",
		})),
	);
	if (!regex) {
		return 0;
	}

	const lookup = buildReplacementLookup(replacements);
	const textNodes = collectTextNodes(root, REPLACEMENT_MARKUP_SKIP_SELECTOR);
	let applied = 0;

	for (const textNode of textNodes) {
		applied += processTextNodeMatches(textNode, regex, (matchedText) => {
			const replacement = lookup.get(matchedText.toLowerCase());
			if (!replacement) {
				return null;
			}

			return createReplacedElement(replacement.to);
		});
	}

	return applied;
}

function applyKeywordHighlights(
	root: HTMLElement,
	keywords: NovelContentData["keywords"],
): number {
	const regex = buildCombinedPattern(
		keywords.map((keyword) => ({
			term: keyword.name,
			matchingType: keyword.matchingType ?? "FULL",
		})),
	);
	if (!regex) {
		return 0;
	}

	const lookup = buildKeywordLookup(keywords);
	const textNodes = collectTextNodes(root, DEFAULT_MARKUP_SKIP_SELECTOR);
	let highlighted = 0;

	for (const textNode of textNodes) {
		highlighted += processTextNodeMatches(textNode, regex, (matchedText) => {
			const keyword = lookup.get(matchedText.toLowerCase());
			if (!keyword) {
				return null;
			}

			return createKeywordElement(matchedText, keyword);
		});
	}

	return highlighted;
}

export function applyContentProcessing(
	root: HTMLElement,
	data: NovelContentData,
	processKey: string,
	options?: { force?: boolean },
): ContentProcessingStats {
	const existingKey = root.getAttribute(PROCESS_ATTR);
	if (!options?.force && existingKey === processKey) {
		console.log(`${LOG_PREFIX} Content already processed for`, processKey);
		return {
			replacementsApplied: 0,
			keywordsHighlighted: 0,
			skipped: true,
		};
	}

	if (existingKey && existingKey !== processKey) {
		root.removeAttribute(PROCESS_ATTR);
	}

	console.log(`${LOG_PREFIX} Applying content processing`, {
		processKey,
		novelId: data.novel.id,
		novelName: data.novel.name,
		chapterNumber: data.chapterNumber,
		keywordsCount: data.keywords.length,
		replacementsCount: data.replacements.length,
		contentLength: root.textContent?.length ?? 0,
	});

	const replacementsApplied = applyReplacements(root, data.replacements);
	const keywordsHighlighted = applyKeywordHighlights(root, data.keywords);

	root.setAttribute(PROCESS_ATTR, processKey);
	root.classList.add("storylens-processed");

	console.log(`${LOG_PREFIX} Content processing finished`, {
		processKey,
		replacementsApplied,
		keywordsHighlighted,
	});

	return {
		replacementsApplied,
		keywordsHighlighted,
		skipped: false,
	};
}

export function buildProcessKey(novelSlug: string, chapter?: number): string {
	return `${novelSlug}:${chapter ?? "unknown"}`;
}

function unwrapMarkupSpan(span: HTMLSpanElement): void {
	const keywordTextNode = [...span.childNodes].find(
		(node): node is Text =>
			node instanceof Text && Boolean(node.textContent?.trim()),
	);
	if (keywordTextNode) {
		span.replaceWith(keywordTextNode.cloneNode(true));
		return;
	}

	span.replaceWith(document.createTextNode(span.textContent ?? ""));
}

export function removeExtensionMarkup(): void {
	const keywordSpans = [...document.querySelectorAll("span.storylens-keyword")];
	for (const span of keywordSpans) {
		if (span instanceof HTMLSpanElement) {
			unwrapMarkupSpan(span);
		}
	}

	const replacedSpans = [
		...document.querySelectorAll("span.storylens-replaced"),
	];
	for (const span of replacedSpans) {
		if (span instanceof HTMLSpanElement) {
			unwrapMarkupSpan(span);
		}
	}

	for (const element of document.querySelectorAll(`[${PROCESS_ATTR}]`)) {
		if (element instanceof HTMLElement) {
			element.removeAttribute(PROCESS_ATTR);
			element.classList.remove("storylens-processed");
		}
	}
}
