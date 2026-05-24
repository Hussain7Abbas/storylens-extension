import { cleanNovelTitle } from '@/lib/utils/novel-title';

export function applyRegexMatch(text: string, regex: string): string | null {
  if (!text.trim() || !regex.trim()) {
    return null;
  }

  try {
    const match = text.match(regex);
    if (!match) {
      return null;
    }

    return match[1] ?? match[0] ?? null;
  } catch {
    return null;
  }
}

export type RegexPreviewResult =
  | { status: 'idle' }
  | { status: 'match'; value: string }
  | { status: 'no-match' }
  | { status: 'invalid-regex' };

function matchRegexResult(text: string, regex: string): RegexPreviewResult {
  if (!regex.trim()) {
    return { status: 'idle' };
  }

  if (!text.trim()) {
    return { status: 'no-match' };
  }

  try {
    const match = text.match(regex);
    if (!match) {
      return { status: 'no-match' };
    }

    const value = match[1] ?? match[0] ?? null;
    if (!value) {
      return { status: 'no-match' };
    }

    return { status: 'match', value };
  } catch {
    return { status: 'invalid-regex' };
  }
}

export function previewUrlRegexResult(
  url: string,
  regex: string,
): RegexPreviewResult {
  return matchRegexResult(url, regex);
}

export function previewUrlRegex(url: string, regex: string): string | null {
  const result = previewUrlRegexResult(url, regex);
  return result.status === 'match' ? result.value : null;
}

function getXpathText(html: string, xpath: string): string | null {
  if (!xpath.trim() || !html.trim()) {
    return null;
  }

  try {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    );

    const text = result.singleNodeValue?.textContent?.replace(/\s+/g, ' ').trim();
    return text || null;
  } catch {
    return null;
  }
}

export function extractXpathText(html: string, xpath: string): string | null {
  return getXpathText(html, xpath);
}

export function previewXpathRegex(
  html: string,
  xpath: string,
  regex: string,
  options?: { cleanNovelTitle?: boolean },
): string | null {
  const result = previewXpathRegexResultFromHtml(html, xpath, regex, options);
  return result.status === 'match' ? result.value : null;
}

export function previewXpathRegexResult(
  xpathText: string | null,
  xpath: string,
  regex: string,
  options?: { cleanNovelTitle?: boolean },
): RegexPreviewResult {
  if (!xpath.trim() || !regex.trim()) {
    return { status: 'idle' };
  }

  if (!xpathText) {
    return { status: 'idle' };
  }

  const result = matchRegexResult(xpathText, regex);
  if (result.status !== 'match') {
    return result;
  }

  const value = options?.cleanNovelTitle
    ? cleanNovelTitle(result.value)
    : result.value;

  if (!value) {
    return { status: 'no-match' };
  }

  return { status: 'match', value };
}

export function previewXpathRegexResultFromHtml(
  html: string,
  xpath: string,
  regex: string,
  options?: { cleanNovelTitle?: boolean },
): RegexPreviewResult {
  return previewXpathRegexResult(getXpathText(html, xpath), xpath, regex, options);
}

export type SelectorPreviewInput = {
  novelXpath: string;
  novelXpathRegex: string;
  novelUrlRegex: string;
  chapterXpath: string;
  chapterXpathRegex: string;
  chapterUrlRegex: string;
};

export function previewXpathExtractResult(
  xpath: string,
  xpathText: string | null,
  hasPageContext: boolean,
): RegexPreviewResult {
  if (!xpath.trim()) {
    return { status: 'idle' };
  }

  if (!hasPageContext) {
    return { status: 'idle' };
  }

  if (xpathText) {
    return { status: 'match', value: xpathText };
  }

  return { status: 'no-match' };
}

export type SelectorPreviewOutput = {
  novelXpathExtract: RegexPreviewResult;
  novelXpathRegex: RegexPreviewResult;
  novelUrl: RegexPreviewResult;
  chapterXpathExtract: RegexPreviewResult;
  chapterXpathRegex: RegexPreviewResult;
  chapterUrl: RegexPreviewResult;
};

const IDLE_PREVIEW: SelectorPreviewOutput = {
  novelXpathExtract: { status: 'idle' },
  novelXpathRegex: { status: 'idle' },
  novelUrl: { status: 'idle' },
  chapterXpathExtract: { status: 'idle' },
  chapterXpathRegex: { status: 'idle' },
  chapterUrl: { status: 'idle' },
};

export type SelectorPreviewContext = {
  pageContext: { url: string; html: string } | null;
  xpathTexts: {
    novel: string | null;
    chapter: string | null;
  };
};

export function computeSelectorPreviews(
  values: SelectorPreviewInput,
  context: SelectorPreviewContext,
): SelectorPreviewOutput {
  const { pageContext, xpathTexts } = context;

  if (!pageContext) {
    return IDLE_PREVIEW;
  }

  return {
    novelXpathExtract: previewXpathExtractResult(
      values.novelXpath,
      xpathTexts.novel,
      true,
    ),
    novelXpathRegex: previewXpathRegexResult(
      xpathTexts.novel,
      values.novelXpath,
      values.novelXpathRegex,
      { cleanNovelTitle: true },
    ),
    novelUrl: previewUrlRegexResult(pageContext.url, values.novelUrlRegex),
    chapterXpathExtract: previewXpathExtractResult(
      values.chapterXpath,
      xpathTexts.chapter,
      true,
    ),
    chapterXpathRegex: previewXpathRegexResult(
      xpathTexts.chapter,
      values.chapterXpath,
      values.chapterXpathRegex,
    ),
    chapterUrl: previewUrlRegexResult(pageContext.url, values.chapterUrlRegex),
  };
}
