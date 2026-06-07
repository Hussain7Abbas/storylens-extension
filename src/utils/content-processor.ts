import type {
	ContentProcessingStats,
	EnrichedKeyword,
	NovelContentData,
	RawKeyword,
	RawKeywordAlias,
} from "@/types/content-data";
import {
	destroyKeywordTooltipPortal,
	initKeywordTooltipPortal,
	registerKeywordTooltipAnchor,
} from "@/utils/keyword-tooltip";
import { enrichKeywords } from "@/utils/resolve-keyword-version";

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

const DEFAULT_MARKUP_SKIP_SELECTOR = ".storylens-keyword";

const REPLACEMENT_MARKUP_SKIP_SELECTOR =
	".storylens-replaced, .storylens-keyword";

type MatchingType = "FULL" | "PARTIAL";

type TermWithMatching = {
	term: string;
	matchingType: MatchingType;
};

function sortTermsByLengthDesc(terms: TermWithMatching[]): TermWithMatching[] {
	return [...terms].sort((left, right) => right.term.length - left.term.length);
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupeTermsCaseInsensitive(
	terms: TermWithMatching[],
): TermWithMatching[] {
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

// Single-letter Arabic proclitics that prefix words with no space.
const ARABIC_SINGLE_LETTER_PREFIXES = new Set(["و", "ف", "ب", "ل", "ك", "س"]);

// Letters that visually connect to the following character in Arabic script.
// و and ا (bare alif) are non-connecting, so they are excluded.
const ARABIC_CONNECTING_LETTERS = new Set(["ب", "ف", "ل", "ك", "س"]);

function withTatweel(prefix: string): string {
	if (!prefix) return prefix;
	const last = prefix[prefix.length - 1];
	return ARABIC_CONNECTING_LETTERS.has(last) ? `${prefix}ـ` : prefix;
}

function findKeywordMatch<T>(
	matchedText: string,
	lookup: Map<string, T>,
): { prefix: string; core: string; value: T } | null {
	// Form 1: bare keyword — exact match, always tried first.
	const exact = lookup.get(matchedText.toLowerCase());
	if (exact) return { prefix: "", core: matchedText, value: exact };

	// Form 2: ال + keyword.
	if (matchedText.startsWith("ال")) {
		const core = matchedText.slice(2);
		const value = lookup.get(core.toLowerCase());
		if (value) return { prefix: "ال", core, value };
	}

	// Forms 3–8: single-letter proclitic + keyword.
	const first = matchedText[0];
	if (first && ARABIC_SINGLE_LETTER_PREFIXES.has(first)) {
		const core = matchedText.slice(1);
		const value = lookup.get(core.toLowerCase());
		if (value) return { prefix: first, core, value };
	}

	return null;
}

function wrapFullTermPattern(escaped: string, term: string): string {
	if (/^\p{Script=Arabic}/u.test(term)) {
		return `(?<![\\p{L}\\p{N}_])(?:ال|[وفبلكس])?${escaped}(?![\\p{L}\\p{N}_])`;
	}
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
			return matchingType === "FULL"
				? wrapFullTermPattern(escaped, term)
				: escaped;
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
	handler: (matchedText: string) => Node | Node[] | null,
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

		const replacementNodes = handler(matchedText);
		if (replacementNodes) {
			const nodes = Array.isArray(replacementNodes)
				? replacementNodes
				: [replacementNodes];
			for (const node of nodes) {
				fragment.appendChild(node);
			}
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

function buildRawContextLookup(
	keywords: RawKeyword[],
): Map<string, { raw: RawKeyword; alias: RawKeywordAlias | null }> {
	const lookup = new Map<
		string,
		{ raw: RawKeyword; alias: RawKeywordAlias | null }
	>();
	for (const kw of keywords) {
		lookup.set(kw.id, { raw: kw, alias: null });
		for (const alias of kw.aliases) {
			lookup.set(alias.id, { raw: kw, alias });
		}
	}
	return lookup;
}

function createKeywordElement(
	matchedText: string,
	keyword: EnrichedKeyword,
	rawContextLookup: Map<
		string,
		{ raw: RawKeyword; alias: RawKeywordAlias | null }
	>,
	currentChapter: number,
): HTMLSpanElement {
	const span = document.createElement("span");
	span.className = "storylens-keyword-tooltip storylens-keyword";
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

	const rawCtx = rawContextLookup.get(keyword.id);
	if (rawCtx) {
		registerKeywordTooltipAnchor(
			span,
			keyword,
			rawCtx.raw,
			rawCtx.alias,
			currentChapter,
		);
	}

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
	keywords: EnrichedKeyword[],
): Map<string, EnrichedKeyword> {
	const lookup = new Map<string, EnrichedKeyword>();
	const sortedKeywords = [...keywords].sort(
		(left, right) => right.name.length - left.name.length,
	);

	for (const keyword of sortedKeywords) {
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
			const found = findKeywordMatch(matchedText, lookup);
			if (!found) return null;
			return createReplacedElement(found.prefix + found.value.to);
		});
	}

	return applied;
}

function applyKeywordHighlights(
	root: HTMLElement,
	keywords: EnrichedKeyword[],
	rawContextLookup: Map<
		string,
		{ raw: RawKeyword; alias: RawKeywordAlias | null }
	>,
	currentChapter: number,
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
			const found = findKeywordMatch(matchedText, lookup);
			if (!found) return null;
			const keywordEl = createKeywordElement(
				found.core,
				found.value,
				rawContextLookup,
				currentChapter,
			);
			if (!found.prefix) return keywordEl;
			return [document.createTextNode(withTatweel(found.prefix)), keywordEl];
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

	const chapter = data.chapterNumber ?? 0;
	const enriched = enrichKeywords(data.keywords, chapter);
	const rawContextLookup = buildRawContextLookup(data.keywords);
	const replacementsApplied = applyReplacements(root, data.replacements);
	const keywordsHighlighted = applyKeywordHighlights(
		root,
		enriched,
		rawContextLookup,
		chapter,
	);

	initKeywordTooltipPortal();

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
	destroyKeywordTooltipPortal();

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
