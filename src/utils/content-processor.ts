import type { GetKeywords200DataItem } from '@/api/schemas';
import type { ContentProcessingStats, NovelContentData } from '@/types/content-data';

const LOG_PREFIX = '[StoryLens]';
const PROCESS_ATTR = 'data-storylens-processed';

const CONTENT_ROOT_SELECTORS = [
  '.chapter-content',
  '[class*="chapter-content"]',
  '[class*="chapter_content"]',
  '[class*="chapter-body"]',
  'article',
  'main',
];

const SKIP_ANCESTOR_SELECTOR =
  'script, style, noscript, textarea, input, select, option, [data-storylens-skip]';

function sortByLengthDesc(values: string[]): string[] {
  return [...values].sort((left, right) => right.length - left.length);
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

function collectTextNodes(root: HTMLElement): Text[] {
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

      if (parent.closest('.storylens-keyword, .tooltip1')) {
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

function replaceInTextNode(
  textNode: Text,
  search: string,
  replacement: string,
): number {
  const text = textNode.textContent ?? '';
  if (!text.includes(search)) {
    return 0;
  }

  const parent = textNode.parentNode;
  if (!parent) {
    return 0;
  }

  const parts = text.split(search);
  const occurrences = parts.length - 1;
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part) {
      fragment.appendChild(document.createTextNode(part));
    }

    if (index < parts.length - 1) {
      fragment.appendChild(document.createTextNode(replacement));
    }
  }

  parent.replaceChild(fragment, textNode);
  return occurrences;
}

function createKeywordElement(
  matchedText: string,
  keyword: GetKeywords200DataItem,
): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'tooltip1 keyword-tooltip storylens-keyword';
  span.style.color = keyword.category.color;
  span.dataset.keywordId = keyword.id;

  const natureIndicator = document.createElement('span');
  natureIndicator.className = 'nature-indicator';
  natureIndicator.style.backgroundColor = keyword.nature.color;
  natureIndicator.setAttribute('aria-hidden', 'true');
  span.append(natureIndicator);
  span.append(document.createTextNode(matchedText));

  const tooltip = document.createElement('span');
  tooltip.className = 'tooltiptext1 keyword-info';

  const title = document.createElement('strong');
  title.textContent = keyword.name;
  tooltip.append(title);

  if (keyword.description) {
    const description = document.createElement('p');
    description.textContent = keyword.description;
    tooltip.append(description);
  }

  const meta = document.createElement('div');
  meta.className = 'keyword-meta';

  const category = document.createElement('span');
  category.className = 'category';
  category.textContent = keyword.category.name;
  category.style.color = keyword.category.color;
  meta.append(category);

  const nature = document.createElement('span');
  nature.className = 'nature';
  nature.textContent = keyword.nature.name;
  nature.style.color = keyword.nature.color;
  meta.append(nature);

  tooltip.append(meta);
  span.append(tooltip);

  return span;
}

function highlightInTextNode(
  textNode: Text,
  search: string,
  keyword: GetKeywords200DataItem,
): number {
  const text = textNode.textContent ?? '';
  if (!text.includes(search)) {
    return 0;
  }

  const parent = textNode.parentNode;
  if (!parent) {
    return 0;
  }

  const parts = text.split(search);
  const occurrences = parts.length - 1;
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part) {
      fragment.appendChild(document.createTextNode(part));
    }

    if (index < parts.length - 1) {
      fragment.appendChild(createKeywordElement(search, keyword));
    }
  }

  parent.replaceChild(fragment, textNode);
  return occurrences;
}

function applyReplacements(
  root: HTMLElement,
  replacements: NovelContentData['replacements'],
): number {
  const sortedFromValues = sortByLengthDesc(
    replacements.map((replacement) => replacement.from).filter(Boolean),
  );
  let applied = 0;

  for (const from of sortedFromValues) {
    const replacement = replacements.find((entry) => entry.from === from);
    if (!replacement) {
      continue;
    }

    const textNodes = collectTextNodes(root);
    for (const textNode of textNodes) {
      applied += replaceInTextNode(textNode, from, replacement.to);
    }
  }

  return applied;
}

function applyKeywordHighlights(
  root: HTMLElement,
  keywords: NovelContentData['keywords'],
): number {
  const sortedKeywords = [...keywords].sort(
    (left, right) => right.name.length - left.name.length,
  );
  let highlighted = 0;

  for (const keyword of sortedKeywords) {
    const textNodes = collectTextNodes(root);
    for (const textNode of textNodes) {
      highlighted += highlightInTextNode(textNode, keyword.name, keyword);
    }
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
  root.classList.add('storylens-processed');

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
  return `${novelSlug}:${chapter ?? 'unknown'}`;
}

export function removeExtensionMarkup(): void {
  const keywordSpans = [...document.querySelectorAll('span.storylens-keyword')];

  for (const span of keywordSpans) {
    if (!(span instanceof HTMLSpanElement)) {
      continue;
    }

    const keywordTextNode = [...span.childNodes].find(
      (node): node is Text =>
        node instanceof Text && Boolean(node.textContent?.trim()),
    );
    if (keywordTextNode) {
      span.replaceWith(keywordTextNode.cloneNode(true));
      continue;
    }

    span.replaceWith(document.createTextNode(span.textContent ?? ''));
  }

  for (const element of document.querySelectorAll(`[${PROCESS_ATTR}]`)) {
    if (element instanceof HTMLElement) {
      element.removeAttribute(PROCESS_ATTR);
      element.classList.remove('storylens-processed');
    }
  }
}
