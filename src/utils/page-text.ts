import type { KeywordContext } from "@/lib/desktop-client/keyword-suggestion";
import { KEYWORD_CONTEXT_CHARS } from "@/lib/desktop-client/keyword-suggestion";

const BLOCK_SELECTOR =
	"address,article,aside,blockquote,dd,div,dl,dt,figcaption,figure,footer,h1,h2,h3,h4,h5,h6,header,li,main,nav,ol,p,pre,section,table,td,th,tr,ul";
// Page code, hidden content, and extension markup (launcher, panels, tooltips).
const SKIPPED_TEXT_SELECTOR =
	"script,style,noscript,template,[hidden],[aria-hidden='true'],[data-storylens-skip],.storylens-keyword-tooltip-root";

/** Calls `visit` for each readable text node, with a space separator when it starts a new block. */
function walkText(
	container: Node,
	visit: (node: Node, value: string, separator: string) => boolean | undefined,
): void {
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) =>
			node.parentElement?.closest(SKIPPED_TEXT_SELECTOR)
				? NodeFilter.FILTER_REJECT
				: NodeFilter.FILTER_ACCEPT,
	});
	let lastBlock: Element | null | undefined;
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const block = node.parentElement?.closest(BLOCK_SELECTOR) ?? null;
		// Separate text from different blocks so paragraphs do not run together.
		const separator = lastBlock !== undefined && block !== lastBlock ? " " : "";
		lastBlock = block;
		if (visit(node, node.textContent ?? "", separator) === false) return;
	}
}

const clean = (value: string) => value.replace(/\s+/g, " ").trim();

/** Readable text of `container`, capped at `limit` characters. */
export function readPageText(container: Node, limit: number): string {
	let text = "";
	walkText(container, (_node, value, separator) => {
		text += separator + value;
		return text.length < limit * 1.2;
	});
	return clean(text).slice(0, limit);
}

/** Page text on both sides of the picked range, read from its closest large enough ancestor. */
export function textAround(range: Range): KeywordContext {
	let container: Node = range.commonAncestorContainer;
	while (
		container !== document.body &&
		container.parentNode &&
		(container.textContent?.length ?? 0) < KEYWORD_CONTEXT_CHARS * 3
	)
		container = container.parentNode;
	let before = "";
	let after = "";
	walkText(container, (node, value, separator) => {
		const head =
			node === range.startContainer
				? value.slice(0, range.startOffset)
				: range.comparePoint(node, 0) < 0
					? value
					: "";
		const tail =
			node === range.endContainer
				? value.slice(range.endOffset)
				: range.comparePoint(node, value.length) > 0
					? value
					: "";
		if (head) before += separator + head;
		if (tail) after += (after ? separator : "") + tail;
		return after.length <= KEYWORD_CONTEXT_CHARS * 2;
	});
	return {
		before: before.replace(/\s+/g, " ").slice(-KEYWORD_CONTEXT_CHARS),
		after: after.replace(/\s+/g, " ").slice(0, KEYWORD_CONTEXT_CHARS),
	};
}
